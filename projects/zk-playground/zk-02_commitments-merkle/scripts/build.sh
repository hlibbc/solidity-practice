#!/usr/bin/env bash
set -euo pipefail

CIRCUIT="${1:-commitment}"
ROOT="$(cd "$(dirname "$0")/.."; pwd)"
BUILD="$ROOT/build/$CIRCUIT"
PTAU="$ROOT/build/pot/pot12_final.ptau"

mkdir -p "$BUILD" "$(dirname "$PTAU")"

if [ ! -f "$PTAU" ]; then
    echo "• downloading/generating ptau..."
    # 작은 예제용. 실제에선 신뢰설정 재사용/다운로드 권장
    npx snarkjs powersoftau new bn128 12 "$ROOT/build/pot/pot12_0000.ptau" -v
    npx snarkjs powersoftau contribute "$ROOT/build/pot/pot12_0000.ptau" "$PTAU" --name="first" -v -e="random text"
fi

echo "• circom compile"
circom "$ROOT/circuits/$CIRCUIT.circom" \
    --r1cs --wasm --sym -o "$BUILD"

echo "• groth16 setup"
npx snarkjs groth16 setup "$BUILD/$CIRCUIT.r1cs" "$PTAU" "$BUILD/$CIRCUIT_0000.zkey"
npx snarkjs zkey contribute "$BUILD/$CIRCUIT_0000.zkey" "$BUILD/$CIRCUIT_final.zkey" --name="1st" -e="another text"

echo "• export verification key"
npx snarkjs zkey export verificationkey "$BUILD/$CIRCUIT_final.zkey" "$BUILD/verification_key.json"

# 입력 파일은 inputs/{circuit}.input.json 로 가정
INPUT="$ROOT/inputs/$CIRCUIT.input.json"
if [ -f "$INPUT" ]; then
    echo "• witness / proof / verify"
    node "$BUILD/${CIRCUIT}_js/generate_witness.js" \
        "$BUILD/${CIRCUIT}_js/${CIRCUIT}.wasm" "$INPUT" "$BUILD/witness.wtns"

    npx snarkjs groth16 prove "$BUILD/$CIRCUIT_final.zkey" "$BUILD/witness.wtns" \
        "$BUILD/proof.json" "$BUILD/public.json"

    npx snarkjs groth16 verify "$BUILD/verification_key.json" "$BUILD/public.json" "$BUILD/proof.json"
fi

echo "• export solidity verifier"
npx snarkjs zkey export verifier "$BUILD/$CIRCUIT_final.zkey" "$ROOT/contracts/${CIRCUIT^}Verifier.sol"

echo "✅ done: $CIRCUIT"
