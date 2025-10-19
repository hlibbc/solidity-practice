#!/usr/bin/env bash
# =============================================================================
# ZK-SNARK Circuit Build Script (other flow, same outcome)
# =============================================================================
# 사용법:
#   ./scripts/build_other.sh [circuit]
# 예:
#   ./scripts/build_other.sh commitment
#   ./scripts/build_other.sh merkle_inclusion
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
# 바이너리 경로 (환경변수로 오버라이드 가능)
# -----------------------------------------------------------------------------
CIRCOM_BIN="${CIRCOM_BIN:-circom}"
SNARKJS_BIN="${SNARKJS_BIN:-snarkjs}"

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

# circomlib include 디렉토리
CIRCOMLIB_DIR="$ROOT/node_modules/circomlib/circuits"

mkdir -p "$BUILD" "$ROOT/contracts"

# -----------------------------------------------------------------------------
# 1) CIRCUIT 컴파일 (r1cs/wasm/sym)
# -----------------------------------------------------------------------------
echo "• circom compile (other)"
"$CIRCOM_BIN" "$ROOT/circuits/$CIRCUIT.circom" \
  --r1cs --wasm --sym \
  -o "$BUILD" \
  -l "$CIRCOMLIB_DIR"

# -----------------------------------------------------------------------------
# 2) R1CS 크기에 맞춘 PTAU 자동 계산/준비
# -----------------------------------------------------------------------------
R1CS_INFO="$("$SNARKJS_BIN" r1cs info "$BUILD/$CIRCUIT.r1cs" || true)"
CONSTRAINTS="$(printf '%s\n' "$R1CS_INFO" \
  | awk '/Constraints/ {for(i=1;i<=NF;i++) if ($i ~ /^[0-9]+$/){print $i; exit}}')"
if ! [[ "$CONSTRAINTS" =~ ^[0-9]+$ ]]; then
  echo "⚠️ Could not parse constraints from snarkjs output. Falling back to 6000."
  CONSTRAINTS=6000
fi
REQ=$(( CONSTRAINTS * 2 ))

# ceil(log2(REQ))
needed_power=0
tmp=$(( REQ - 1 ))
while [ $tmp -gt 0 ]; do
  tmp=$(( tmp >> 1 ))
  needed_power=$(( needed_power + 1 ))
done
[ $needed_power -lt 14 ] && needed_power=14

PTAU="$ROOT/build/pot/pot${needed_power}_final.ptau"
mkdir -p "$(dirname "$PTAU")"

have_power=""
if [ -f "$PTAU" ]; then
  have_power=$("$SNARKJS_BIN" powersoftau verify "$PTAU" 2>/dev/null | awk '/power:/ {print $2; exit}')
fi

echo "• circuit constraints: $CONSTRAINTS  → required power: $needed_power"
echo "• using PTAU: $PTAU"
[ -n "$have_power" ] && echo "  detected PTAU power: $have_power"

if [ ! -f "$PTAU" ] || [ -z "$have_power" ] || [ "$have_power" -lt "$needed_power" ]; then
  echo "• (re)creating PTAU (power=$needed_power)"
  "$SNARKJS_BIN" powersoftau new bn128 $needed_power "$ROOT/build/pot/pot${needed_power}_0000.ptau" -v
  "$SNARKJS_BIN" powersoftau contribute "$ROOT/build/pot/pot${needed_power}_0000.ptau" \
                                            "$ROOT/build/pot/pot${needed_power}_0001.ptau" --name="first" -v -e="random text"
  "$SNARKJS_BIN" powersoftau prepare phase2 "$ROOT/build/pot/pot${needed_power}_0001.ptau" "$PTAU"
fi

# -----------------------------------------------------------------------------
# 3) Groth16 setup (zkey 생성) + 검증키 export
# -----------------------------------------------------------------------------
echo "• groth16 setup (other)"
"$SNARKJS_BIN" groth16 setup "$BUILD/$CIRCUIT.r1cs" "$PTAU" "$BUILD/${CIRCUIT}_0000.zkey"
"$SNARKJS_BIN" zkey contribute "$BUILD/${CIRCUIT}_0000.zkey" "$BUILD/${CIRCUIT}_final.zkey" --name="1st" -e="another text"

echo "• export verification key (other)"
"$SNARKJS_BIN" zkey export verificationkey "$BUILD/${CIRCUIT}_final.zkey" "$VK"

# -----------------------------------------------------------------------------
# 4) 입력 있으면 witness/증명/검증 수행
#    입력 경로 규칙: inputs/<circuit>.input.json
# -----------------------------------------------------------------------------
INPUT="$ROOT/inputs/$CIRCUIT.input.json"
if [ -f "$INPUT" ]; then
  echo "• witness / prove / verify (other)"
  node "$WASM_DIR/generate_witness.js" "$WASM" "$INPUT" "$WITNESS"
  "$SNARKJS_BIN" groth16 prove "$BUILD/${CIRCUIT}_final.zkey" "$WITNESS" "$PROOF" "$PUBLIC"
  "$SNARKJS_BIN" groth16 verify "$VK" "$PUBLIC" "$PROOF"
else
  echo "• skip prove/verify (no input: $INPUT)"
fi

# -----------------------------------------------------------------------------
# 5) Solidity Verifier 생성 (PascalCase)
# -----------------------------------------------------------------------------
echo "• export solidity verifier (other)"
PascalCircuit="$(echo "$CIRCUIT" | awk -F'[_-]' '{s=""; for(i=1;i<=NF;i++){s=s toupper(substr($i,1,1)) substr($i,2)}; print s}')"
"$SNARKJS_BIN" zkey export solidityverifier "$BUILD/${CIRCUIT}_final.zkey" "$ROOT/contracts/${PascalCircuit}Verifier.sol"

echo "✅ done(other): $CIRCUIT"


