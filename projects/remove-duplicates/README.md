# Remove Duplicates Challenge

이 프로젝트는 Solidity에서 배열의 중복 요소를 제거하는 함수를 구현하는 챌린지입니다.

## 🎯 문제 설명

### 목표
- `uint8[]` 배열에서 중복된 요소를 제거
- 원본 배열의 순서를 유지하면서 중복 제거
- 가스 효율성을 고려한 최적화된 구현

### 함수 시그니처
```solidity
function dispelDuplicates(uint8[] calldata input) public pure returns (uint8[] memory output)
```

## 📋 구현 세부사항

### 알고리즘
1. **boolean 배열을 사용한 중복 체크**: `bool[256] memory seen`
2. **한 번의 순회로 중복 제거**: O(n) 시간 복잡도
3. **Assembly를 사용한 배열 크기 조정**: 메모리 효율성 최적화

### 핵심 로직
```solidity
bool[256] memory seen;
uint count = 0;

output = new uint8[](input.length);
for (uint i = 0; i < input.length; ++i) {
    if (!seen[input[i]]) {
        seen[input[i]] = true;
        output[count++] = input[i];
    }
}

// 배열 크기 조정
if (count < input.length) {
    assembly {
        mstore(output, count)
    }
}
```

## 🧪 테스트 구조

### 테스트 파일
- `test/Challenge1.test.js`: 메인 테스트 파일
- `test/testsuites/testChallenge.js`: 테스트 유틸리티 함수
- `test/data/inputs.json`: 테스트 입력 데이터

### 테스트 케이스
- **정확성 테스트**: 598개의 다양한 입력 케이스
- **가스 효율성 테스트**: 평균 가스 소비량 60,000 이하
- **외부 코드 테스트**: 컨트랙트 코드 검증

### 입력 데이터 예시
```json
{
  "input": [114, 175, 157, 250, 87, 122, 196, 161, 114, 250, 157, 58, 177, 9, 126, 126, 250, 140, 247, 4, 122],
  "expected": [114, 175, 157, 250, 87, 122, 196, 161, 58, 177, 9, 126, 140, 247, 4]
}
```

## 🚀 실행 방법

### 테스트 실행
```bash
# 모든 테스트 실행
npx hardhat test

# 특정 테스트 파일 실행
npx hardhat test test/Challenge1.test.js
```

### 컴파일
```bash
npx hardhat compile
```

## 📊 성능 요구사항

### 정확성
- 모든 테스트 케이스 통과
- 중복 제거 정확성 100%
- 원본 순서 유지

### 가스 효율성
- 평균 가스 소비량: 60,000 이하
- 최적화된 메모리 사용
- 효율적인 알고리즘 구현

## 🔧 기술적 특징

### 메모리 최적화
- **Assembly 사용**: `mstore`로 배열 크기 동적 조정
- **불필요한 메모리 할당 방지**: 정확한 크기로 조정

### 가스 최적화
- **한 번의 순회**: O(n) 시간 복잡도
- **boolean 배열**: 빠른 중복 체크
- **calldata 사용**: 입력 데이터 가스 비용 최소화

### 안전성
- **uint8 범위**: 0-255 값만 처리
- **배열 경계 체크**: 안전한 인덱싱
- **pure 함수**: 상태 변경 없음

## 📁 프로젝트 구조

```
projects/remove-duplicates/
├── contracts/
│   └── Challenge.sol          # 메인 컨트랙트
├── test/
│   ├── Challenge1.test.js     # 메인 테스트
│   ├── data/
│   │   └── inputs.json        # 테스트 데이터
│   └── testsuites/
│       └── testChallenge.js   # 테스트 유틸리티
├── hardhat.config.js
└── README.md
```

## 🎯 학습 포인트

1. **메모리 관리**: Assembly를 사용한 동적 배열 크기 조정
2. **가스 최적화**: 효율적인 알고리즘과 데이터 구조 선택
3. **테스트 커버리지**: 다양한 엣지 케이스 테스트
4. **성능 측정**: 가스 소비량 모니터링

## ⚠️ 주의사항

- **uint8 범위**: 0-255 값만 처리 가능
- **메모리 제한**: 큰 배열 처리 시 가스 한계 고려
- **순서 유지**: 원본 배열의 순서를 보존해야 함 