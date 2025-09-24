#!/usr/bin/env bash
# =============================================================================
# ZK-SNARK Circuit Build Script (Commitment / Merkle Inclusion)
# =============================================================================
# 사용법:
#   ./scripts/build.sh [circuit]
# 예:
#   ./scripts/build.sh commitment
#   ./scripts/build.sh merkle_inclusion
#
# 산출물 규칙:
#   build/<circuit>/
#     - <circuit>.r1cs / .sym
#     - <circuit>_js/<circuit>.wasm (+ generate_witness.js)
#     - <circuit>_0000.zkey / <circuit>_final.zkey
#     - <circuit>.verification_key.json
#     - <circuit>.wtns / <circuit>.proof.json / <circuit>.public.json
#   contracts/<PascalCase(circuit)>Verifier.sol
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# 기본 설정
# -----------------------------------------------------------------------------
CIRCUIT="${1:-commitment}"
ROOT="$(cd "$(dirname "$0")/.."; pwd)"
BUILD="$ROOT/build/$CIRCUIT"
WASM_DIR="$BUILD/${CIRCUIT}_js"
WASM="$WASM_DIR/${CIRCUIT}.wasm"
WITNESS="$BUILD/${CIRCUIT}.wtns"
PROOF="$BUILD/${CIRCUIT}.proof.json"
PUBLIC="$BUILD/${CIRCUIT}.public.json"
VK="$BUILD/${CIRCUIT}.verification_key.json"

# circomlib include 디렉토리 (프로젝트 의존성에 맞춰 조정 가능)
CIRCOMLIB_DIR="$ROOT/node_modules/circomlib/circuits"

mkdir -p "$BUILD" "$ROOT/contracts"

# -----------------------------------------------------------------------------
# 1) CIRCUIT 컴파일 (r1cs/wasm/sym)
# -----------------------------------------------------------------------------
echo "• circom compile"
circom "$ROOT/circuits/$CIRCUIT.circom" \
  --r1cs --wasm --sym \
  -o "$BUILD" \
  -l "$CIRCOMLIB_DIR"

# -----------------------------------------------------------------------------
# 2) R1CS 크기에 맞춘 PTAU 자동 계산/준비
#    required_power = ceil(log2(constraints*2)), 최소 14 보장
#    PTAU 파일 경로: build/pot/pot<POWER>_final.ptau
# -----------------------------------------------------------------------------
R1CS_INFO="$(pnpm -s dlx snarkjs r1cs info "$BUILD/$CIRCUIT.r1cs" || true)"
CONSTRAINTS="$(printf '%s\n' "$R1CS_INFO" \
  | awk '/Constraints/ {for(i=1;i<=NF;i++) if ($i ~ /^[0-9]+$/){print $i; exit}}')"
if ! [[ "$CONSTRAINTS" =~ ^[0-9]+$ ]]; then
  echo "⚠️ Could not parse constraints from snarkjs output. Falling back to 6000."
  CONSTRAINTS=6000
fi
REQ=$(( CONSTRAINTS * 2 ))

# ceil(log2(REQ)) 계산 (정수 비트 시프트; macOS bash 3.2 호환)
needed_power=0
tmp=$(( REQ - 1 ))
while [ $tmp -gt 0 ]; do
  tmp=$(( tmp >> 1 ))
  needed_power=$(( needed_power + 1 ))
done
# 안전마진: 최소 14
if [ $needed_power -lt 14 ]; then needed_power=14; fi

PTAU="$ROOT/build/pot/pot${needed_power}_final.ptau"
mkdir -p "$(dirname "$PTAU")"

# 현재 PTAU의 power 읽기 (있으면)
have_power=""
if [ -f "$PTAU" ]; then
  have_power=$(pnpm -s dlx snarkjs powersoftau verify "$PTAU" 2>/dev/null | awk '/power:/ {print $2; exit}')
fi

echo "• circuit constraints: $CONSTRAINTS  → required power: $needed_power"
echo "• using PTAU: $PTAU"
if [ -n "$have_power" ]; then
  echo "  detected PTAU power: $have_power"
fi

# 없거나 파워가 부족하면 새로 생성 (로컬 생성 방식)
if [ ! -f "$PTAU" ] || [ -z "$have_power" ] || [ "$have_power" -lt "$needed_power" ]; then
  echo "• (re)creating PTAU (power=$needed_power)"
  pnpm -s dlx snarkjs powersoftau new bn128 $needed_power "$ROOT/build/pot/pot${needed_power}_0000.ptau" -v
  pnpm -s dlx snarkjs powersoftau contribute "$ROOT/build/pot/pot${needed_power}_0000.ptau" \
                                            "$ROOT/build/pot/pot${needed_power}_0001.ptau" --name="first" -v -e="random text"
  pnpm -s dlx snarkjs powersoftau prepare phase2 "$ROOT/build/pot/pot${needed_power}_0001.ptau" "$PTAU"
fi

# -----------------------------------------------------------------------------
# 3) Groth16 setup (zkey 생성) + 검증키 export
# -----------------------------------------------------------------------------
echo "• groth16 setup"
pnpm -s dlx snarkjs groth16 setup "$BUILD/$CIRCUIT.r1cs" "$PTAU" "$BUILD/${CIRCUIT}_0000.zkey"
pnpm -s dlx snarkjs zkey contribute "$BUILD/${CIRCUIT}_0000.zkey" "$BUILD/${CIRCUIT}_final.zkey" --name="1st" -e="another text"

echo "• export verification key"
pnpm -s dlx snarkjs zkey export verificationkey "$BUILD/${CIRCUIT}_final.zkey" "$VK"

# -----------------------------------------------------------------------------
# 4) 입력 있으면 witness/증명/검증 수행
#    입력 경로 규칙: inputs/<circuit>.input.json
# -----------------------------------------------------------------------------
INPUT="$ROOT/inputs/$CIRCUIT.input.json"
if [ -f "$INPUT" ]; then
  echo "• witness / prove / verify"
  node "$WASM_DIR/generate_witness.js" "$WASM" "$INPUT" "$WITNESS"

  pnpm -s dlx snarkjs groth16 prove "$BUILD/${CIRCUIT}_final.zkey" "$WITNESS" "$PROOF" "$PUBLIC"
  pnpm -s dlx snarkjs groth16 verify "$VK" "$PUBLIC" "$PROOF"
else
  echo "• skip prove/verify (no input: $INPUT)"
fi

# -----------------------------------------------------------------------------
# 5) Solidity Verifier 생성 (PascalCase)
# -----------------------------------------------------------------------------
echo "• export solidity verifier"
PascalCircuit="$(echo "$CIRCUIT" | awk -F'[_-]' '{s=""; for(i=1;i<=NF;i++){s=s toupper(substr($i,1,1)) substr($i,2)}; print s}')"
pnpm -s dlx snarkjs zkey export solidityverifier "$BUILD/${CIRCUIT}_final.zkey" "$ROOT/contracts/${PascalCircuit}Verifier.sol"

echo "✅ done: $CIRCUIT"
