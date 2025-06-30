import { useState, useEffect } from 'react'
import { useContractWrite, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { parseUnits } from 'viem'

// 토큰 컨트랙트 주소 (실제 배포 주소로 교체 필요)
const TOKEN_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

// ERC20 ABI
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'transferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
]

export function useTransfer() {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')

  const { data, write, isLoading, error } = useContractWrite({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: to && amount ? [to, parseUnits(amount, 18)] : undefined,
    enabled: Boolean(to && amount)
  })
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: data?.hash
  })

  return {
    to,
    setTo,
    amount,
    setAmount,
    transfer: write,
    isLoading: isLoading || isConfirming,
    isSuccess,
    error,
    hash: data?.hash
  }
}

export function useApproveAndTransfer() {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState('idle') // 'idle', 'approving', 'transferring'

  const { address } = useAccount()

  // approve
  const { data: approveData, write: approve, isLoading: isApproving, error: approveError } = useContractWrite({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: address && amount && step === 'approving' ? [address, parseUnits(amount, 18)] : undefined,
    enabled: Boolean(address && amount && step === 'approving')
  })

  // transferFrom
  const { data: transferData, write: transfer, isLoading: isTransferring, error: transferError } = useContractWrite({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'transferFrom',
    args: address && to && amount && step === 'transferring' ? [address, to, parseUnits(amount, 18)] : undefined,
    enabled: Boolean(address && to && amount && step === 'transferring')
  })

  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveData?.hash
  })

  const { isLoading: isTransferConfirming, isSuccess: isTransferSuccess } = useWaitForTransactionReceipt({
    hash: transferData?.hash
  })

  const executeApproveAndTransfer = async () => {
    if (!to || !amount || !address) return
    setStep('approving')
    approve?.()
  }

  // approve가 성공하면 자동으로 transfer 실행
  useEffect(() => {
    if (isApproveSuccess && step === 'approving') {
      setStep('transferring')
      transfer?.()
    }
  }, [isApproveSuccess, step, transfer])

  // transfer가 성공하면 초기화
  useEffect(() => {
    if (isTransferSuccess) {
      setStep('idle')
      setTo('')
      setAmount('')
    }
  }, [isTransferSuccess])

  return {
    to,
    setTo,
    amount,
    setAmount,
    executeApproveAndTransfer,
    isLoading: isApproving || isApproveConfirming || isTransferring || isTransferConfirming,
    isSuccess: isTransferSuccess,
    error: approveError || transferError,
    approveHash: approveData?.hash,
    transferHash: transferData?.hash,
    step
  }
} 