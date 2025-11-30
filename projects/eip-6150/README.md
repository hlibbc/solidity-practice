### EIP-6150 데모 프로젝트 (Hierarchical NFTs)

이 저장소는 EIP-6150 계층형 NFT 표준을 이해하고 실습하기 위한 최소 예제입니다. `MyERC6150.sol` 구현체와 Foundry 기반 테스트/스크립트를 제공하여, 루트/자식 민트, 부모 변경, 리프 소각, 접근 제어 및 열거/조회 동작을 한 번에 체험할 수 있습니다.


### 폴더 구조

- `contracts/MyERC6150.sol`: ERC-721 기반 EIP-6150 구현(Enumerable, Burnable, ParentTransferable, AccessControl 뷰 포함)
- `foundry/test/Demo.t.sol`: 핵심 기능에 대한 단위 테스트
- `foundry/script/Demo.s.sol`: 로컬 체인에서 배포/데모 실행 스크립트


### 요구사항

- Foundry(Forge/Anvil) 설치
  - 설치: 공식 문서 `foundryup` 참고
- Solidity 0.8.20


### 빠른 시작

```bash
# 프로젝트 루트로 이동
cd /home/hong/works/solidity-practice/projects/eip-6150

# 빌드
forge build

# 테스트 실행(자세한 로그는 -vv)
forge test -vv
```


### 스크립트로 시연하기

로컬 노드(Anvil)를 띄우고, 배포/데모 스크립트를 실행합니다.

```bash
# 1) 로컬 노드 실행
anvil
```

별도 터미널에서:

```bash
# 2) PRIVATE_KEY 환경변수 설정(예: anvil의 첫 번째 계정 프라이빗키)
export PRIVATE_KEY=0x........................................................

# 3) 배포/데모 스크립트 실행
forge script foundry/script/Demo.s.sol:DeployAndDemo \
  --rpc-url http://127.0.0.1:8545 --broadcast
```

스크립트는 다음 순서로 진행됩니다.
- `MyERC6150` 배포
- 루트 민터 권한 부여
- 루트/자식 민트 → 자식 소각 → 재민트 후 부모 변경
- 각 단계 로그 출력


### 컨트랙트 개요: `MyERC6150.sol`

- ERC-721을 기반으로 트리형 구조를 유지합니다.
- 주요 개념
  - **루트(Root)**: 부모가 없는 노드
  - **자식(Child)**: 부모가 존재하는 노드
  - **리프(Leaf)**: 자식이 없는 노드
- 핵심 기능
  - 루트 발행: `mintRoot(to)`
  - 자식 발행: `mintChild(to, parentId)`
  - 부모 변경: `transferParent(newParentId, tokenId)`
  - 소각(리프만): `safeBurn(tokenId)`, `safeBatchBurn(tokenIds)`
  - 조회/열거: `isRoot`, `isLeaf`, `parentOf`, `childrenOf`, `childrenCountOf`, `childOfParentByIndex`, `indexInChildrenEnumeration`
  - 접근 제어(뷰): 토큰별 admin 개념 지원(`setTokenAdmin`, 민트/소각 권한 판단)
  - 루트 민터 권한: `setRootMinter(account, allowed)`


### 제약 및 보안 고려

- 소각은 리프 토큰에 한해 가능합니다. 부모가 되는 토큰은 자식이 모두 제거되어 리프가 된 후에 소각할 수 있습니다.
- 부모 변경 시:
  - 자기 자신을 부모로 지정 불가
  - 순환(자손을 부모로 지정) 금지
- 자식 목록은 동적 배열로 관리하며, 삭제 시 스왑-팝을 사용하므로 자식의 순서는 보장되지 않습니다.


### 테스트 시나리오 요약

- 루트/자식 민트 후 소유/리프/루트 여부 확인
- 부모 변경 성공 및 순환/자기부모 지정 시 revert 확인
- 리프 전용 소각 규칙 검증(개별/배치)
- 접근 제어: 특정 부모 하위 민트 권한(소유자/관리자) 및 소각 권한 검증


### 예시 사용 흐름

```solidity
// 루트 민트
uint256 r1 = rev.mintRoot(alice);
// 자식 민트
uint256 c1 = rev.mintChild(alice, r1);
// 부모 변경
rev.transferParent(newRootId, c1);
// 리프 소각
rev.safeBurn(c1);
```


### 자주 묻는 질문(FAQ)

- Q. 왜 리프만 소각 가능한가요?
  - A. 트리 무결성을 보장하기 위함입니다. 중간 노드를 지우면 구조가 깨질 수 있습니다.

- Q. 부모 변경 시 어떤 검사가 이뤄지나요?
  - A. 존재성 검사, self-parent 금지, 순환(자손을 부모로 지정) 금지 검사를 수행합니다.


### 라이선스

- MIT


