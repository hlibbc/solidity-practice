#!/usr/bin/env bash
set -euo pipefail

CIRCUIT=addition
BUILD_DIR=build/$CIRCUIT
PTAU=pot12_0001.ptau

# 로컬 or 지정 바이너리 우선 사용
CIRCOM_BIN="${CIRCOM_BIN:-npx circom}"
SNARKJS_BIN="${SNARKJS_BIN:-npx snarkjs}"

mkdir -p "$BUILD_DIR"

# 1) 컴파일
$CIRCOM_BIN circuits/$CIRCUIT.circom --r1cs --wasm --sym -o $BUILD_DIR

# 2) Powers of Tau (최초 1회)
if [ ! -f $PTAU ]; then
  $SNARKJS_BIN powersoftau new bn128 12 pot12_0000.ptau -v
  $SNARKJS_BIN powersoftau contribute pot12_0000.ptau $PTAU --name="first contribution" -v
fi

# 3) 회로 전용 키
$SNARKJS_BIN groth16 setup $BUILD_DIR/$CIRCUIT.r1cs $PTAU $BUILD_DIR/${CIRCUIT}_0000.zkey
$SNARKJS_BIN zkey export verificationkey $BUILD_DIR/${CIRCUIT}_0000.zkey $BUILD_DIR/verification_key.json

# 4) 예시 입력
cat > $BUILD_DIR/input.json <<'JSON'
{ "a": 3, "b": 4 }
JSON

# 5) witness
node $BUILD_DIR/${CIRCUIT}_js/generate_witness.js $BUILD_DIR/${CIRCUIT}_js/$CIRCUIT.wasm $BUILD_DIR/input.json $BUILD_DIR/witness.wtns

# 6) 증명/검증
$SNARKJS_BIN groth16 prove $BUILD_DIR/${CIRCUIT}_0000.zkey $BUILD_DIR/witness.wtns $BUILD_DIR/proof.json $BUILD_DIR/public.json
$SNARKJS_BIN groth16 verify $BUILD_DIR/verification_key.json $BUILD_DIR/public.json $BUILD_DIR/proof.json

# 7) Verifier.sol
$SNARKJS_BIN zkey export verifier $BUILD_DIR/${CIRCUIT}_0000.zkey contracts/${CIRCUIT}_Verifier.sol

echo "OK: $CIRCUIT build complete. Verifier at contracts/${CIRCUIT}_Verifier.sol"
