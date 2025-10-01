#!/usr/bin/env bash
# shellcheck disable=SC2155
# Bash 3 호환: 연관배열 없이 case 매핑 사용
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
# node_modules/circomlib 등 추가하려면 아래 주석 해제
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
if [ $# -eq 0 ]; then
    usage
    exit 0
fi

# ==============================================================================
# Utils
# ==============================================================================
require_cmd() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "[ERR] '$1' not found. Please install." >&2
        exit 1
    }
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
            echo "[ERR] Unknown target: $sel" >&2
            exit 1
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

# ==============================================================================
# PTAU 자동 산정 & 보장
# ==============================================================================
calc_needed_power_from_r1cs() {
    require_cmd snarkjs
    local r1cs="$1"
    local info="$(snarkjs r1cs info "$r1cs" 2>/dev/null || true)"
    local constraints="$(printf "%s\n" "$info" | grep -i "constraints" | grep -Eo '[0-9]+' | head -1)"
    if [ -z "${constraints:-}" ]; then
        echo "${MIN_PTAU_POWER}"; return 0
    fi
    local REQ="$constraints" needed=0 tmp=$((REQ - 1))
    while [ $tmp -gt 0 ]; do tmp=$((tmp >> 1)); needed=$((needed + 1)); done
    [ $needed -lt $MIN_PTAU_POWER ] && needed=$MIN_PTAU_POWER
    echo "$needed"
}

ensure_ptau() {
    require_cmd snarkjs
    local power="$1"
    local raw="${POWERS_DIR}/pot${power}.ptau"
    local final="${POWERS_DIR}/pot${power}_final.ptau"
    mkdir -p "${POWERS_DIR}"
    if [ ! -f "$raw" ]; then
        echo "[POT] powersoftau new -> $raw"
        snarkjs powersoftau new bn128 "$power" "$raw" -v
    else
        echo "[POT] exists: $raw"
    fi
    if [ ! -f "$final" ]; then
        echo "[POT] contribute -> $final"
        snarkjs powersoftau contribute "$raw" "$final" --name="auto contribution" -v
    else
        echo "[POT] exists: $final"
    fi
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
    # out: ${out}/${key}.wrapper.r1cs, ${out}/${key}.wrapper_js/${key}.wrapper.wasm
}

step_key_one() {
    require_cmd snarkjs
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    local r1cs="${out}/${key}.wrapper.r1cs"
    echo "[KEY] $key"
    local pow="$(calc_needed_power_from_r1cs "$r1cs")"
    echo "    - required PTAU power: $pow"
    local PTAU="$(ensure_ptau "$pow")"
    echo "    - using PTAU: $PTAU"
    snarkjs groth16 setup "$r1cs" "$PTAU" "${out}/${key}_0000.zkey"
    snarkjs zkey contribute "${out}/${key}_0000.zkey" "${out}/${key}_final.zkey" --name="${key} contributor" -v
    snarkjs zkey export verificationkey "${out}/${key}_final.zkey" "${out}/verification_key.json"
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
    require_cmd snarkjs
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    echo "[PROVE] $key"
    snarkjs groth16 prove "${out}/${key}_final.zkey" "${out}/witness.wtns" "${out}/proof.json" "${out}/public.json"
}

step_verify_one() {
    require_cmd snarkjs
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    echo "[VERIFY] $key"
    snarkjs groth16 verify "${out}/verification_key.json" "${out}/public.json" "${out}/proof.json"
}

step_calldata_one() {
    require_cmd snarkjs
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    echo "[CALLDATA] $key"
    snarkjs generatecall "${out}/proof.json" "${out}/public.json" > "${out}/calldata.txt"
    echo "  -> ${out}/calldata.txt"
}

step_verifier_one() {
    require_cmd snarkjs
    local key="$1"
    local out="${BUILD_ROOT}/${key}"
    mkdir -p "${CONTRACTS_DIR}"
    local sol="${CONTRACTS_DIR}/${key}_Verifier.sol"
    local cname="${key}_Verifier"  # Bash3 호환: 간단한 식별자 사용
    echo "[SOLIDITY VERIFIER] $key -> ${sol} (contract ${cname})"
    # snarkjs가 --name 옵션을 지원하면 사용, 아니면 sed로 대체
    if snarkjs zkey export solidityverifier --help 2>/dev/null | grep -q -- "--name"; then
        snarkjs zkey export solidityverifier "${out}/${key}_final.zkey" "${sol}" --name "${cname}"
    else
        snarkjs zkey export solidityverifier "${out}/${key}_final.zkey" "${sol}"
        # BSD sed 호환 치환: 'contract Verifier' → 'contract <cname>'
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
    do_calldata "$target"
    do_verifier "$target"
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
