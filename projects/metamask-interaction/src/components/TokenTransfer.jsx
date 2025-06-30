import React from 'react'
import { useTransfer } from '../hooks/useToken'

function TokenTransfer() {
  const {
    to,
    setTo,
    amount,
    setAmount,
    transfer,
    isLoading,
    isSuccess,
    error,
    hash
  } = useTransfer()

  const handleTransfer = () => {
    if (!to || !amount) return
    transfer?.()
  }

  return (
    <div>
      <div>
        <input
          type="text"
          placeholder="받는 주소"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <div>
        <input
          type="number"
          placeholder="수량"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <button 
        onClick={handleTransfer}
        disabled={!to || !amount || isLoading}
      >
        {isLoading ? '전송 중...' : '전송'}
      </button>
      
      {isSuccess && (
        <p className="success">
          전송 성공! TX Hash: {hash}
        </p>
      )}
      
      {error && (
        <p className="error">
          전송 실패: {error.message}
        </p>
      )}
    </div>
  )
}

export default TokenTransfer 