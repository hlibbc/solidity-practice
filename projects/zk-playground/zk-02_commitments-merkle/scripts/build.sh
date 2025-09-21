#!/usr/bin/env bash

# =============================================================================
# ZK-SNARK Circuit Build Script (Commitments/Merkle)
# =============================================================================
# 이 스크립트는 circom으로 작성된 "커밋먼트/머클" 계열 회로를 빌드하고,
# Groth16 프로토콜 기반 설정(PTAU), 증명 생성/검증, Solidity 검증자 생성까지 수행합니다.
#
# 사용법:
#   ./scripts/build.sh [circuit]
# 예시:
#   ./scripts/build.sh commitment              # circuits/commitment.circom
#   ./scripts/build.sh merkle                  # circuits/merkle.circom (존재할 경우)
#
# 주의:
# - Phase1/Phase2로 생성되는 PTAU 파일은 한 번 생성 후 여러 회로에서 재사용할 수 있습니다.
# - inputs/{circuit}.input.json 파일이 있을 경우에만 증명/검증(witness, prove, verify)을 수행합니다.
# - circomlib 회로를 사용하는 경우 -l 경로를 명시합니다.
# =============================================================================

# 에러 즉시 종료, 정의되지 않은 변수 사용 금지, 파이프라인 에러 전파
set -euo pipefail

# =============================================================================
# 설정 변수
# =============================================================================
# CIRCUIT: 컴파일할 회로 이름 (기본: commitment)
CIRCUIT="${1:-commitment}"

# ROOT: 리포지터리 루트(프로젝트 루트)
ROOT="$(cd "$(dirname "$0")/.."; pwd)"

# BUILD: 회로별 산출물 디렉터리
BUILD="$ROOT/build/$CIRCUIT"

# PTAU: Phase2 준비 완료된 Powers of Tau 파일 경로(재사용 권장)
PTAU="$ROOT/build/pot/pot12_final.ptau"

# 디렉터리 준비
mkdir -p "$BUILD" "$(dirname "$PTAU")"

# =============================================================================
# Powers of Tau (SRS) 준비
# =============================================================================
# - Phase1: 곡선/사이즈를 지정하여 범용 SRS를 생성하고, 임의 기여(contribute)로 랜덤성 추가
# - Phase2: 특정 회로에 맞도록 SRS 준비 (pot12_final.ptau)
if [ ! -f "$PTAU" ]; then
    echo "• Powers of Tau 준비 (phase1 → phase2)"
    mkdir -p "$(dirname "$PTAU")"
    # bn128, 2^12 사이즈로 새로운 ptau 생성 (초기 SRS)
    npx snarkjs powersoftau new bn128 12 "$ROOT/build/pot/pot12_0000.ptau" -v
    # 첫 번째 기여(랜덤성) — 이름과 엔트로피 문구는 예시용
    npx snarkjs powersoftau contribute "$ROOT/build/pot/pot12_0000.ptau" "$ROOT/build/pot/pot12_0001.ptau" --name="first" -v -e="random text"
    # Phase2 준비 (Groth16용 SRS 변환)
    npx snarkjs powersoftau prepare phase2 "$ROOT/build/pot/pot12_0001.ptau" "$PTAU"
fi


# =============================================================================
# 회로 컴파일 (circom)
# =============================================================================
echo "• circom compile"
# 산출물:
# - ${CIRCUIT}.r1cs : 수학적 제약식(R1CS) 설계도
# - ${CIRCUIT}.wasm : witness 계산용 WASM
# - ${CIRCUIT}.sym  : 디버깅용 심볼 테이블
circom "$ROOT/circuits/$CIRCUIT.circom" \
    --r1cs --wasm --sym -o "$BUILD" \
    -l "$ROOT/node_modules/circomlib/circuits"

# =============================================================================
# Groth16 설정 (회로 전용 proving/verification key 생성)
# =============================================================================
echo "• groth16 setup"
# R1CS + Phase2-PTAU → 첫 zkey 생성 (회로 전용 키 번들)
npx snarkjs groth16 setup "$BUILD/$CIRCUIT.r1cs" "$PTAU" "$BUILD/${CIRCUIT}_0000.zkey"
# zkey에 추가 기여(랜덤성) 후 최종 zkey 확정
npx snarkjs zkey contribute "$BUILD/${CIRCUIT}_0000.zkey" "$BUILD/${CIRCUIT}_final.zkey" --name="1st" -e="another text"

# =============================================================================
# Verification Key 추출 (검증에 필요한 공개키)
# =============================================================================
echo "• export verification key"
npx snarkjs zkey export verificationkey "$BUILD/${CIRCUIT}_final.zkey" "$BUILD/verification_key.json"

# =============================================================================
# 입력 존재 시: witness 계산 → 증명 생성 → 검증
# =============================================================================
# 입력 파일 경로 규칙: inputs/{circuit}.input.json
INPUT="$ROOT/inputs/$CIRCUIT.input.json"
if [ -f "$INPUT" ]; then
    echo "• witness / proof / verify"
    # WASM 실행으로 witness(wtns) 생성
    node "$BUILD/${CIRCUIT}_js/generate_witness.js" \
        "$BUILD/${CIRCUIT}_js/${CIRCUIT}.wasm" "$INPUT" "$BUILD/witness.wtns"

    # 증명(proof.json)과 공개 입력(public.json) 생성
    npx snarkjs groth16 prove "$BUILD/${CIRCUIT}_final.zkey" "$BUILD/witness.wtns" \
        "$BUILD/proof.json" "$BUILD/public.json"

    # 검증 (verification key + 공개 입력 + 증명)
    npx snarkjs groth16 verify "$BUILD/verification_key.json" "$BUILD/public.json" "$BUILD/proof.json"
else
    echo "• skip prove/verify (no input: $INPUT)"
fi

# =============================================================================
# Solidity 검증자 컨트랙트 생성 (온체인 검증용)
# =============================================================================
echo "• export solidity verifier"
npx snarkjs zkey export solidityverifier "$BUILD/${CIRCUIT}_final.zkey" "$ROOT/contracts/${CIRCUIT^}Verifier.sol"


echo "✅ done: $CIRCUIT"
