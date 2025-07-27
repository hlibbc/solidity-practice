
---

## 🧩 주요 컨트랙트 및 구성요소

- **Diamond.sol**  
  - 모든 함수 호출을 Facet(모듈)로 delegatecall하는 프록시 컨트랙트
  - EIP-2535 표준 준수

- **facets/**  
  - `DiamondCutFacet`: Facet 추가/제거/교체(diamondCut) 기능 제공
  - `DiamondLoupeFacet`: Facet/Selector/주소 조회(표준 Loupe)
  - `OwnershipFacet`: 소유권 이전/조회
  - `Test1Facet`, `Test2Facet`: 테스트용 임의 함수 다수 포함

- **libraries/LibDiamond.sol**  
  - 다이아몬드 스토리지 구조, 접근 제어, diamondCut 내부 로직 등 핵심 구현

- **interfaces/**  
  - EIP-2535 표준 인터페이스(IDiamond, IDiamondCut, IDiamondLoupe, IERC165, IERC173 등)

---

## 🧪 테스트

### Foundry 기반 테스트

- `foundry/test/Diamond.t.sol`  
  - Facet 추가/제거/교체, 셀렉터 매핑, 함수 호출, 대량 Facet 관리 등 다양한 시나리오 검증
- `foundry/test/CacheBug.t.sol`  
  - 셀렉터 슬롯/캐시 버그 재현 및 안전성 검증

#### 실행 방법
```bash
cd projects/diamonds
forge install
forge test -vv
```

### Hardhat + JS 기반 테스트

- `test/diamond.debug.test.js`, `test/cacheBug.debug.test.js`
- Hardhat 환경에서 JS로도 동일한 시나리오를 검증 가능

#### 실행 방법
```bash
pnpm install
pnpm --filter diamonds run test
# 또는
cd projects/diamonds
npx hardhat test
```

---

## ⚙️ 개발/실행 환경

- Solidity 0.8.28
- Hardhat (evmVersion: cancun)
- Foundry (forge)
- Node.js, pnpm

---

## 💡 학습 포인트

- EIP-2535 다이아몬드 패턴의 구조와 delegatecall 기반 모듈화
- Facet(기능 모듈) 동적 추가/제거/교체(diamondCut)
- 셀렉터와 Facet 주소 매핑, Loupe 표준
- 소유권 관리, 업그레이드 안전성
- 셀렉터 슬롯/캐시 버그 등 실전 이슈
- JS/Foundry 기반 테스트 비교

---

## 📚 참고

- [EIP-2535 Diamonds 표준](https://eips.ethereum.org/EIPS/eip-2535)
- [mudgen/diamond-3-hardhat](https://github.com/mudgen/diamond-3-hardhat) (원본 예제)
- [Foundry 공식문서](https://book.getfoundry.sh/)

---

## 👨‍💻 빠른 시작

```bash
# Foundry 테스트
forge install
forge test -vv

# Hardhat 테스트
pnpm install
npx hardhat test
```

---

이 프로젝트는 다이아몬드 패턴의 실전 구조와 테스트, 버그 케이스까지 모두 경험할 수 있는 실습용 예제입니다.  