#!/usr/bin/env bash
# =============================================================================
# ZK-SNARK Circuit Build Script
# =============================================================================
# 이 스크립트는 circom으로 작성된 ZK-SNARK 회로를 컴파일하고,
# Groth16 프로토콜을 위한 설정, 증명 생성, 검증을 수행합니다.
# 
# 사용법: ./build.sh [circuit_name]
# 예시: ./build.sh addition
# =============================================================================

### 에러 발생 시 즉시 종료, 정의되지 않은 변수 사용 시 에러, 파이프라인 에러 시 즉시 종료
# -e (errexit): 명령이 0이 아닌 종료 코드를 반환하면 즉시 스크립트를 종료
# -u (nounset): 정의되지 않은 변수를 참조하면 오류로 간주하고 종료
# -o pipefail (pipefail): 파이프라인(a | b | c)에서 어느 한 단계라도 실패하면 전체가 실패로 간주
set -euo pipefail

echo "ARGS 분석 **********"
echo "- 스크립트 이름: $0"
echo "- 총 아규먼트 개수: $#"
echo "*******************"

i=1
for arg in "$@"; do
    printf '- 아규먼트%u: %s\n' "$i" "$arg"
    i=$((i+1))
done
echo "*******************"

# pnpm run build -- addition 처럼 들어와도 안전하게 처리
# pnpm이 -- 구분자를 추가하는 경우를 대비한 안전장치
if [[ "${1-}" == "--" ]]; then
    shift; 
fi

# =============================================================================
# 설정 변수들
# =============================================================================
CIRCUIT="${1:-addition}" # 기본값: addition (회로 이름)
OUTDIR="build/${CIRCUIT}" # 출력 디렉토리

# PTAU 파일들 (루트에 두고 여러 회로에서 재사용 권장)
# Powers of Tau는 신뢰할 수 있는 설정을 위한 공개 매개변수입니다
PHASE1="pot12_0001.ptau" # Phase 1 완료된 PTAU 파일
PTAU_FINAL="pot12_final.ptau" # Phase 2 준비 완료된 PTAU 파일

# 바이너리 경로 설정 (환경변수로 오버라이드 가능)
CIRCOM_BIN="${CIRCOM_BIN:-/usr/local/bin/circom}" # circom v2.x 컴파일러
SNARKJS_BIN="${SNARKJS_BIN:-pnpm exec snarkjs}" # 로컬 snarkjs (pnpm workspace)

# =============================================================================
# 초기 설정
# =============================================================================
mkdir -p "${OUTDIR}"

echo "==> Compile circuit: ${CIRCUIT}"
# =============================================================================
# circom으로 회로 컴파일: R1CS, WASM, 심볼 테이블 생성
# =============================================================================
# R1CS: “수학식으로 바꾼 회로 설계도”. (정적 정의)
# WASM: “입력값을 받아 witness 생성해주는 계산기”. (동적 실행)
# SYM: 디버깅용 심볼 테이블
#
# Circom 컴파일을 통해..
# addition.circom → addition.r1cs(설계도), addition.wasm(계산기)
"${CIRCOM_BIN}" "circuits/${CIRCUIT}.circom" --r1cs --wasm --sym -o "${OUTDIR}"


### 엔트로피(비대화식 실행용). 환경변수로 덮어쓰기 가능
# ${ENTROPY:-…}: 파라미터 확장 문법: ENTROPY가 unset이거나 빈 값이면 …를 대신 사용합니다. 이미 값이 있으면 그 값을 유지합니다.
# $( … ): 명령 치환: 괄호 안의 명령을 실행한 출력 결과 문자열로 치환합니다.
# head -c 64 /dev/urandom: 보안용 난수 소스 /dev/urandom에서 64바이트를 읽습니다(512비트).
# | base64: 이 바이트들을 ASCII 안전 문자열(Base64)로 변환합니다. CLI 인수로 넘기기 편해집니다.
# tr -d '\n': 엔트로피 생성 시 개행 제거
ENTROPY="${ENTROPY:-$(head -c 64 /dev/urandom | base64 | tr -d '\n')}"

# =============================================================================
# Powers of Tau 설정 (Phase 1 & 2)
# =============================================================================
# 1) phase1: new + contribute (최초 1회만 실행)
# 2) phase2 준비: prepare phase2 -> pot12_final.ptau
#
# Powers of Tau (ptau): “공유 초기 재료(SRS: Structured Reference String)”.
# Powers of Tau는 ZK-SNARK의 신뢰할 수 있는 설정을 위한 공개 매개변수입니다.
# 이 과정은 한 번만 실행하면 되며, 여러 회로에서 재사용할 수 있습니다.
# Phase1: 공유 초기 재료 만들기 (회로에 상관없이 쓸 수 있는 범용 SRS를 만드는 단계)
# Phase2: 회로 맞춤 재료로 변환 (Phase1에서 생성한 범용 SRS를 특정 회로에 맞게 변환해서, 그 회로의 증명키/검증키(zkey)를 만드는 단계)
# .... Phase1에서 생성한 범용 SRS를 특정 회로에 맞게 변환 -> phase1의 ptau를 특정회로(R1CS)에 결합
if [[ ! -f "${PTAU_FINAL}" ]]; then
    if [[ ! -f "${PHASE1}" ]]; then
        echo "==> Powers of Tau (phase1) - 최초 실행"
        # bn128 곡선, 2^12 크기로 새로운 PTAU 파일 생성
        ${SNARKJS_BIN} powersoftau new bn128 12 pot12_0000.ptau -v
        # 첫 번째 기여 수행 (랜덤성 추가): snarkjs@0.7.5 호환: 엔트로피를 표준입력으로 전달
        printf '%s\n' "${ENTROPY}" | ${SNARKJS_BIN} powersoftau contribute pot12_0000.ptau "${PHASE1}" -v
    fi
    echo "==> Prepare phase2 -> ${PTAU_FINAL}"
    # Phase 2 준비 (Groth16 프로토콜용)
    ${SNARKJS_BIN} powersoftau prepare phase2 "${PHASE1}" "${PTAU_FINAL}"
fi

# =============================================================================
# Groth16 설정 -> 회로 전용 키 생성
# =============================================================================
echo "==> Groth16 setup"
# Groth16 프로토콜을 위한 proving key와 verification key 생성
# R1CS: 회로를 수학적 제약식으로 바꾼 설계도, circom 컴파일 결과로 *.r1cs가 나옴
# Groth16은 R1CS를 입력으로 사용해 KEY를 만든다.
# zkey: “이 회로 전용의 증명키/검증키(묶음)”.
${SNARKJS_BIN} groth16 setup "${OUTDIR}/${CIRCUIT}.r1cs" "${PTAU_FINAL}" "${OUTDIR}/${CIRCUIT}_0000.zkey"

echo "==> Export verification key"
# 검증을 위한 공개키 추출
# verification key: “검증에 필요한 공개 키”.
${SNARKJS_BIN} zkey export verificationkey "${OUTDIR}/${CIRCUIT}_0000.zkey" "${OUTDIR}/verification_key.json"

# =============================================================================
# 샘플 입력 파일 생성
# =============================================================================
# 각 회로 유형에 맞는 샘플 입력값을 자동으로 생성합니다
if [[ ! -f "${OUTDIR}/input.json" ]]; then
    echo "==> Write sample input.json"
    case "${CIRCUIT}" in
        addition|subtraction|multiplication)
            # 기본 산술 연산: a와 b 두 개의 입력값
            cat > "${OUTDIR}/input.json" <<'JSON'
            { "a": 3, "b": 4 }
JSON
        ;;
        division)
            # 나눗셈: a = b*q + r 형태 (예: 17 = 5*3 + 2)
            # a: 피제수, b: 제수, q: 몫, r: 나머지
            cat > "${OUTDIR}/input.json" <<'JSON'
            { "a": 17, "b": 5, "q": 3, "r": 2 }
JSON
        ;;
        *)
            # 기타 회로의 경우 사용자가 직접 input.json을 제공해야 함
            echo "Provide ${OUTDIR}/input.json for circuit: ${CIRCUIT}"
        ;;
    esac
fi

# =============================================================================
# 증명 생성 및 검증
# =============================================================================
echo "==> Calculate witness"
# WASM으로 witness 계산 (회로의 모든 중간값들)
# witness: “회로의 모든 내부 값(증거재료)”.
${SNARKJS_BIN} wtns calculate "${OUTDIR}/${CIRCUIT}_js/${CIRCUIT}.wasm" "${OUTDIR}/input.json" "${OUTDIR}/witness.wtns"

echo "==> Prove"
# Groth16 프로토콜로 증명 생성
# proving key, witness, 증명 파일, 공개 입력값 파일 생성
${SNARKJS_BIN} groth16 prove "${OUTDIR}/${CIRCUIT}_0000.zkey" "${OUTDIR}/witness.wtns" "${OUTDIR}/proof.json" "${OUTDIR}/public.json"

echo "==> Verify"
# 생성된 증명 검증
# verification key, 공개 입력값, 증명 파일을 사용하여 검증
# proof.json: “증명 결과”
# public.json: “공개되는 값”
${SNARKJS_BIN} groth16 verify "${OUTDIR}/verification_key.json" "${OUTDIR}/public.json" "${OUTDIR}/proof.json"

# =============================================================================
# Solidity 검증자 생성
# =============================================================================
echo "==> Export Solidity verifier"
# Solidity 스마트 컨트랙트로 검증자 생성
# 이 파일을 블록체인에 배포하여 온체인에서 증명 검증 가능
# Solidity Verifier: “온체인에서 증명 체크해주는 컨트랙트”
${SNARKJS_BIN} zkey export solidityverifier "${OUTDIR}/${CIRCUIT}_0000.zkey" "contracts/${CIRCUIT}_Verifier.sol"

echo "OK: ${CIRCUIT} build complete -> contracts/${CIRCUIT}_Verifier.sol"

