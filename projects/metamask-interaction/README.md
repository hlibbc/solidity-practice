# MetaMask Interaction

MetaMask와의 상호작용을 테스트하는 프로젝트입니다.

## 기능

- 🦊 MetaMask 지갑 연결
- 🚀 ERC20 토큰 전송 (transfer)
- 🛂 토큰 승인 후 전송 (approve + transferFrom)

## 구현 방식

### 1. Vanilla JavaScript + Ethers.js (기존)
- `frontend/index.html` - 순수 HTML/JS 구현
- `frontend/libs/MyToken.js` - Ethers.js를 사용한 Web3 연동

### 2. React + Wagmi (새로운 구현)
- `src/` - React + Wagmi 기반 구현
- 더 안전하고 현대적인 Web3 개발 방식

## 설치 및 실행

### Wagmi 버전 (권장)

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

### 기존 Vanilla JS 버전

```bash
# 의존성 설치
npm install

# 컨트랙트 컴파일
npm run compile

# 컨트랙트 배포
npm run deploy

# frontend/index.html을 브라우저에서 열기
```

## Wagmi 버전의 장점

1. **타입 안전성**: TypeScript 지원으로 컴파일 타임 에러 방지
2. **자동 재연결**: 네트워크 변경 시 자동으로 재연결
3. **캐싱**: React Query를 통한 효율적인 데이터 캐싱
4. **상태 관리**: 연결 상태, 계정 변경 등을 자동으로 관리
5. **에러 처리**: 더 나은 에러 처리 및 사용자 경험
6. **트랜잭션 추적**: 트랜잭션 상태를 실시간으로 추적

## 주요 컴포넌트

### WalletConnect
- MetaMask 연결/해제
- 연결된 계정 주소 표시

### TokenTransfer
- 직접 토큰 전송 (transfer)
- 실시간 트랜잭션 상태 표시

### ApproveAndTransfer
- 2단계 프로세스: approve → transferFrom
- 각 단계별 상태 표시

## 커스텀 훅

### useTransfer
- transfer 함수를 위한 훅
- 입력 검증 및 트랜잭션 상태 관리

### useApproveAndTransfer
- approve + transferFrom 시퀀스를 위한 훅
- 자동화된 2단계 프로세스

## 설정

토큰 컨트랙트 주소를 실제 배포된 주소로 변경하세요:

```javascript
// src/hooks/useToken.js
const TOKEN_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3' // 실제 주소로 변경
```

## 네트워크 지원

- Ethereum Mainnet
- Sepolia Testnet
- Localhost (Hardhat)

## 기술 스택

### Wagmi 버전
- React 18
- Wagmi 2.x
- Viem 2.x
- TanStack Query
- Vite

### 기존 버전
- Vanilla JavaScript
- Ethers.js 6.x
- HTML/CSS 