사전조건
rust, nodejs, npm 설치되어 있어야 함


mkdir zk-vote && cd zk-vote
npm init -y
npm install hardhat
npx hardhat init
npm install snarkjs
npm install git+https://github.com/iden3/circomlib.git

wget https://github.com/iden3/circom/releases/download/v2.1.6/circom-linux-amd64
chmod +x circom-linux-amd64
sudo mv circom-linux-amd64 /usr/local/bin/circom
circom --version

mkdir circuits && cd circuits
vote.circom 작성

npx snarkjs powersoftau new bn128 15 pot15_0000.ptau


npx snarkjs powersoftau contribute pot15_0000.ptau pot15_contributed.ptau --name="contrib"
npx snarkjs powersoftau prepare phase2 pot15_contributed.ptau final.ptau

circom vote.circom --r1cs --wasm --sym -l ../node_modules
npx snarkjs groth16 setup vote.r1cs final.ptau vote_000.zkey
npx snarkjs zkey contribute vote_000.zkey vote.zkey --name="setup"
npx snarkjs zkey export verificationkey vote.zkey verification_key.json
npx snarkjs zkey export solidityverifier vote.zkey ../contracts/Verifier.sol
cd ..

contracts/ZKVote.sol 작성
배포 및 실행 스크립트 작성


npx hardhat compile

npx hardhat run scripts/deploy.js --network localhost

node scripts/generateProof.js
npx hardhat run scripts/submitVote.js --network localhost

npx hardhat run scripts/revealVote.js --network localhost

npx hardhat run scripts/checkResult.js --network localhost