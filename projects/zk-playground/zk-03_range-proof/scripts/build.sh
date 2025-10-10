#!/usr/bin/env bash
# Mac/Bash3, zsh에서 실행될 경우를 대비해 bash로 재실행
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

# ==============================================================================
# Path setup
# ==============================================================================
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CIRCUIT_DIR="${ROOT_DIR}/circuits"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
INPUT_DIR="${ROOT_DIR}/test/inputs"
BUILD_ROOT="${ROOT_DIR}/lib/build"
POWERS_DIR="${ROOT_DIR}/lib/powers"

# circom include 경로(필요 시 추가)
INCLUDE_DIRS=("${CIRCUIT_DIR}")
# circomlib 경로 자동 추가
[ -d "${ROOT_DIR}/node_modules" ] && INCLUDE_DIRS+=("${ROOT_DIR}/node_modules")
[ -d "${ROOT_DIR}/node_modules/circomlib/circuits" ] && INCLUDE_DIRS+=("${ROOT_DIR}/node_modules/circomlib/circuits")
# [ -d "${ROOT_DIR}/node_modules/circomlib/circuits" ] && INCLUDE_DIRS+=("${ROOT_DIR}/node_modules/circomlib/circuits")

# 최소 PTAU power (환경변수로 오버라이드 가능)
MIN_PTAU_POWER="${MIN_PTAU_POWER:-14}"

# 타깃 키 목록 (5개 메인 인스턴스)
TARGETS=(booleanity equal_enforce equal_bool lt13 range_13_10_300)

# ==============================================================================
# Help
# ==============================================================================
usage() {
    cat <<'EOF'
Usage:
  ./scripts/build.sh pot [power]            # 선택: pot<power>_final.ptau 미리 생성
  ./scripts/build.sh compile [target|all]   # circom -> r1cs/wasm/sym (wrapper 생성)
  ./scripts/build.sh key [target|all]       # R1CS → PTAU 자동산정 → zkey/vkey
  ./scripts/build.sh witness [target|all]   # input.json → witness.wtns
  ./scripts/build.sh prove [target|all]     # wtns → proof.json/public.json
  ./scripts/build.sh verify [target|all]    # 로컬 검증
  ./scripts/build.sh calldata [target|all]  # calldata.txt 생성
  ./scripts/build.sh verifier [target|all]  # Solidity Verifier.sol 생성(고유 이름)
  ./scripts/build.sh all [target|all]       # 전체 파이프라인
  ./scripts/build.sh clean                  # lib/build/* 정리

Targets:
  booleanity            → booleanity.circom / component main = Booleanity();
  equal_enforce         → equalCheck.circom / component main = EnforceEqual();
  equal_bool            → equalCheck.circom / component main = IsEqualBool();
  lt13                  → lessThan.circom   / component main = LessThanBool(13);
  range_13_10_300       → rangeProof.circom / component main = RangeProof(13, 10, 300);

Inputs:
  test/inputs/<target>.input.json (각 회로의 signal input 키와 일치해야 함)

Artifacts:
  lib/build/<target>/*
EOF
}

# 인자 없으면 help 보장
if [ $# -eq 0 ]; then usage; exit 0; fi

# ==============================================================================
# Utils
# ==============================================================================
require_cmd() {
    command -v "$1" >/dev/null 2>&1 || { echo "[ERR] '$1' not found. Please install." >&2; exit 1; }
}
exists_in_array() {
    local needle="$1"; shift
    for x in "$@"; do [ "$x" = "$needle" ] && return 0; done
    return 1
}
resolve_targets() {
    local sel="${1:-all}"
    if [ "$sel" = "all" ]; then
        echo "${TARGETS[@]}"
    else
        if ! exists_in_array "$sel" "${TARGETS[@]}"; then
            echo "[ERR] Unknown target: $sel" >&2; exit 1
        fi
        echo "$sel"
    fi
}
ensure_inputs_dir() { mkdir -p "${INPUT_DIR}"; }
ci_includes_flags() {
    local flags=()
    for d in "${INCLUDE_DIRS[@]}"; do flags+=(-l "$d"); done
    printf "%s " "${flags[@]}"
}

# key→src, key→main 매핑 (Bash3 호환: case 사용)
get_src_for() {
    case "$1" in
        booleanity) echo "booleanity.circom" ;;
        equal_enforce|equal_bool) echo "equalCheck.circom" ;;
        lt13) echo "lessThan.circom" ;;
        range_13_10_300) echo "rangeProof.circom" ;;
        *) echo "[ERR] no src for key=$1" >&2; exit 1 ;;
    esac
}
get_main_for() {
    case "$1" in
        booleanity) echo "Booleanity()" ;;
        equal_enforce) echo "EnforceEqual()" ;;
        equal_bool) echo "IsEqualBool()" ;;
        lt13) echo "LessThanBool(13)" ;;
        range_13_10_300) echo "RangeProof(13, 10, 300)" ;;
        *) echo "[ERR] no main expr for key=$1" >&2; exit 1 ;;
    esac
}

# === Heartbeat logger (30s 간격; HEARTBEAT_EVERY로 조정) ===
HEARTBEAT_EVERY="${HEARTBEAT_EVERY:-30}"
heartbeat() {
    local pid="$1"; local label="$2"; local every="${3:-$HEARTBEAT_EVERY}"
    [ "$every" -le 0 ] && return 0
    while kill -0 "$pid" 2>/dev/null; do
        echo "[... $(date +%H:%M:%S)] ${label} (still running)" >&2
        sleep "$every"
    done
}
run_hb() {
    local label="$1"; shift
    # ★ child stdout→stderr로 리다이렉트해서 호출부의 $(...)에 섞이지 않게 한다
    ( "$@" 1>&2 ) & local cmdpid=$!
    heartbeat "$cmdpid" "$label" &
    local hpid=$!
    wait "$cmdpid"; local status=$?
    kill "$hpid" 2>/dev/null || true
    wait "$hpid" 2>/dev/null || true
    return $status
}

# === Entropy generator for snarkjs --entropy / -e ===
make_entropy() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        # 포터블 난수 (충분히 비대화식)
        echo "$RANDOM-$(date +%s 2>/dev/null || echo 0)-$RANDOM-$$-${HOSTNAME:-h}"
    fi
}


# --- SNARKJS runner (auto-detect: PATH, pnpm dlx, npx) -----------------------
SNARKJS_ARR=()
ensure_snarkjs() {
    if [ -n "${SNARKJS:-}" ] && [ ${#SNARKJS_ARR[@]} -eq 0 ]; then
        IFS=' ' read -r -a SNARKJS_ARR <<< "$SNARKJS"; return
    fi
    if command -v snarkjs >/dev/null 2>&1; then SNARKJS_ARR=(snarkjs); return; fi
    if command -v pnpm   >/dev/null 2>&1; then SNARKJS_ARR=(pnpm -s dlx snarkjs); return; fi
    if command -v npx    >/dev/null 2>&1; then SNARKJS_ARR=(npx -y snarkjs); return; fi
    echo "[ERR] snarkjs not found. Install pnpm/npx or set SNARKJS=\"pnpm -s dlx snarkjs\"." >&2
    exit 1
}
sj() { ensure_snarkjs; "${SNARKJS_ARR[@]}" "$@"; }

# ==============================================================================
# PTAU 자동 산정 & 보장
# ==============================================================================
calc_needed_power_from_r1cs() {
    local r1cs="$1"
    local info constraints REQ needed tmp

    # r1cs 정보 추출
    info="$(sj r1cs info "$r1cs" 2>/dev/null || true)"

    # '# of constraints:' 라인에서 숫자만 정확히 추출
    constraints="$(printf "%s\n" "$info" | awk -F': ' '/# of constraints/ {print $2}' | tr -cd '0-9')"

    # 파싱 실패 시 최소 파워 사용
    if [ -z "${constraints:-}" ]; then
        echo "${MIN_PTAU_POWER}"
        return 0
    fi

    REQ="$constraints"
    # 0이나 비정상 값 방지
    if ! [ "$REQ" -ge 1 ] 2>/dev/null; then
        echo "${MIN_PTAU_POWER}"
        return 0
    fi

    needed=0
    tmp=$(( REQ - 1 ))
    while [ $tmp -gt 0 ]; do
        tmp=$(( tmp >> 1 ))
        needed=$(( needed + 1 ))
    done

    # 안전 마진: 최소 MIN_PTAU_POWER 보장
    if [ "$needed" -lt "$MIN_PTAU_POWER" ]; then
        needed="$MIN_PTAU_POWER"
    fi

    echo "$needed"
}

ensure_ptau() {
    local power="$1"

    # sanity check
    if ! [[ "$power" =~ ^[0-9]+$ ]]; then
        echo "[WARN] invalid power '$power'; fallback to MIN_PTAU_POWER=${MIN_PTAU_POWER}" >&2
        power="${MIN_PTAU_POWER}"
    fi
    if [ "$power" -lt 1 ] || [ "$power" -gt 28 ]; then
        echo "[WARN] power out of range ($power); clamp to [1,28] then apply MIN_PTAU_POWER" >&2
        [ "$power" -lt 1 ] && power=1
        [ "$power" -gt 28 ] && power=28
        if [ "$power" -lt "$MIN_PTAU_POWER" ]; then power="$MIN_PTAU_POWER"; fi
    fi

    local raw="${POWERS_DIR}/pot${power}.ptau"
    local final="${POWERS_DIR}/pot${power}_final.ptau"
    mkdir -p "${POWERS_DIR}"

    if [ ! -f "$raw" ]; then
        echo "[POT] powersoftau new -> $raw" >&2
        run_hb "powersoftau new (2^$power)" sj powersoftau new bn128 "$power" "$raw" -v
    else
        echo "[POT] exists: $raw" >&2
    fi

    if [ ! -f "$final" ]; then
        # ⚠️ snarkjs 0.7.5는 contribute에 옵션이 없어 비대화식이 어려움 → prepare phase2 사용
        echo "[POT] prepare phase2 -> $final" >&2
        run_hb "powersoftau prepare phase2 (2^$power)" sj powersoftau prepare phase2 "$raw" "$final"
    else
        echo "[POT] exists: $final" >&2
    fi

    # stdout에는 '경로'만 출력 (호출측에서 $(...)로 안전히 받도록)
    printf "%s" "$final"
}



# ==============================================================================
# Steps
# ==============================================================================
step_pot() {
    local power="${1:-$MIN_PTAU_POWER}"
    ensure_ptau "$power" >/dev/null
}
make_wrapper_for() {
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    local src_rel="$(get_src_for "$key")"
    local main_expr="$(get_main_for "$key")"
    local src_abs="${CIRCUIT_DIR}/${src_rel}"
    local wrapper="${out}/${key}.wrapper.circom"
    mkdir -p "$out"
    cat > "$wrapper" <<EOF
pragma circom 2.1.6;
include "${src_abs}";
// Auto-generated main wrapper for target '${key}'
component main = ${main_expr};
EOF
    echo "$wrapper"
}
step_compile_one() {
    require_cmd circom
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    mkdir -p "$out"
    echo "[COMPILE] $key"
    local wrapper="$(make_wrapper_for "$key")"
    # shellcheck disable=SC2207
    local lflags=($(ci_includes_flags))
    circom "$wrapper" --r1cs --wasm --sym -o "$out" "${lflags[@]}"
}
step_key_one() {
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    local r1cs="${out}/${key}.wrapper.r1cs"
    echo "[KEY] $key"
    local pow="$(calc_needed_power_from_r1cs "$r1cs")"
    echo "    - required PTAU power: $pow"
    local PTAU="$(ensure_ptau "$pow")"
    echo "    - using PTAU: $PTAU"
    sj groth16 setup "$r1cs" "$PTAU" "${out}/${key}_0000.zkey"
    sj zkey contribute "${out}/${key}_0000.zkey" "${out}/${key}_final.zkey" --name="${key} contributor" -v
    sj zkey export verificationkey "${out}/${key}_final.zkey" "${out}/verification_key.json"
}
step_witness_one() {
    require_cmd node
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    local js="${out}/${key}.wrapper_js"
    local wasm="${js}/${key}.wrapper.wasm"
    local input="${INPUT_DIR}/${key}.input.json"
    echo "[WITNESS] $key (input: ${input})"
    [ -f "$input" ] || { echo "[ERR] input not found: $input" >&2; exit 1; }
    node "${js}/generate_witness.js" "$wasm" "$input" "${out}/witness.wtns"
}
step_prove_one() {
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    echo "[PROVE] $key"
    sj groth16 prove "${out}/${key}_final.zkey" "${out}/witness.wtns" "${out}/proof.json" "${out}/public.json"
}
step_verify_one() {
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    echo "[VERIFY] $key"
    sj groth16 verify "${out}/verification_key.json" "${out}/public.json" "${out}/proof.json"
}
step_calldata_one() {
    require_cmd node
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    echo "[CALLDATA] $key"
    # 실패해도 파이프라인 계속 진행 (snarkjs 0.7.x에서 public 0개 회로가 실패할 수 있음)
    if ! sj generatecall "${out}/proof.json" "${out}/public.json" > "${out}/calldata.txt" 2> "${out}/calldata.err"; then
        echo "[WARN] generatecall failed for ${key}. Likely no public signals. Skipping calldata." >&2
        # 필요하면 빈 파일이라도 남겨 디버깅에 도움
        : > "${out}/calldata.txt"
    else
        echo "  -> ${out}/calldata.txt"
    fi
}

step_verifier_one() {
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    mkdir -p "${CONTRACTS_DIR}"
    local sol="${CONTRACTS_DIR}/${key}_Verifier.sol"
    local cname="${key}_Verifier"
    echo "[SOLIDITY VERIFIER] $key -> ${sol} (contract ${cname})"
    if sj zkey export solidityverifier --help 2>/dev/null | grep -q -- "--name"; then
        sj zkey export solidityverifier "${out}/${key}_final.zkey" "${sol}" --name "${cname}"
    else
        sj zkey export solidityverifier "${out}/${key}_final.zkey" "${sol}"
        sed -i '' "s/contract[[:space:]]\+Verifier/contract ${cname}/" "${sol}" 2>/dev/null \
        || sed -i "s/contract[[:space:]]\+Verifier/contract ${cname}/" "${sol}"
    fi
}

do_compile()  { local t=($(resolve_targets "${1:-all}")); for k in "${t[@]}"; do step_compile_one "$k";  done; }
do_key()      { local t=($(resolve_targets "${1:-all}")); for k in "${t[@]}"; do step_key_one "$k";      done; }
do_witness()  { ensure_inputs_dir; local t=($(resolve_targets "${1:-all}")); for k in "${t[@]}"; do step_witness_one "$k";  done; }
do_prove()    { local t=($(resolve_targets "${1:-all}")); for k in "${t[@]}"; do step_prove_one "$k";    done; }
do_verify()   { local t=($(resolve_targets "${1:-all}")); for k in "${t[@]}"; do step_verify_one "$k";   done; }
do_calldata() { local t=($(resolve_targets "${1:-all}")); for k in "${t[@]}"; do step_calldata_one "$k"; done; }
do_verifier() { local t=($(resolve_targets "${1:-all}")); for k in "${t[@]}"; do step_verifier_one "$k"; done; }

do_all() {
    local target="${1:-all}"
    do_compile "$target"
    do_key "$target"
    do_witness "$target"
    do_prove "$target"
    do_verify "$target"
    do_verifier "$target"
    do_calldata "$target"
}

do_clean() {
    if [ -d "${BUILD_ROOT}" ]; then
        echo "[CLEAN] rm -rf ${BUILD_ROOT}"
        rm -rf "${BUILD_ROOT}"
    fi
}

# ==============================================================================
# Main
# ==============================================================================
cmd="${1:-help}"
arg="${2:-all}"
case "$cmd" in
    pot)        step_pot "${2:-$MIN_PTAU_POWER}" ;;
    compile)    do_compile "$arg" ;;
    key)        do_key "$arg" ;;
    witness)    do_witness "$arg" ;;
    prove)      do_prove "$arg" ;;
    verify)     do_verify "$arg" ;;
    calldata)   do_calldata "$arg" ;;
    verifier)   do_verifier "$arg" ;;
    all)        do_all "$arg" ;;
    clean)      do_clean ;;
    help|*)     usage ;;
esac
