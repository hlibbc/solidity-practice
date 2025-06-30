import React from 'react'
import { useApproveAndTransfer } from '../hooks/useToken'

function ApproveAndTransfer() {
  const {
    to,
    setTo,
    amount,
    setAmount,
    executeApproveAndTransfer,
    isLoading,
    isSuccess,
    error,
    approveHash,
    transferHash,
    step
  } = useApproveAndTransfer()

  const handleApproveAndTransfer = () => {
    if (!to || !amount) return
    executeApproveAndTransfer()
  }

  const getStepText = () => {
    switch (step) {
      case 'approving':
        return '승인 중...'
      case 'transferring':
        return '전송 중...'
      default:
        return '승인 + 전송'
    }
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
        onClick={handleApproveAndTransfer}
        disabled={!to || !amount || isLoading}
      >
        {isLoading ? getStepText() : '승인 + 전송'}
      </button>
      
      {step === 'approving' && approveHash && (
        <p className="success">
          승인 성공! TX Hash: {approveHash}
        </p>
      )}
      
      {isSuccess && (
        <p className="success">
          전송 성공! TX Hash: {transferHash}
        </p>
      )}
      
      {error && (
        <p className="error">
          실패: {error.message}
        </p>
      )}
    </div>
  )
}

export default ApproveAndTransfer 