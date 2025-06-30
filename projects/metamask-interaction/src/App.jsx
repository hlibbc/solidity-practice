import React from 'react'
import { WagmiConfig } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from './config/wagmi'
import WalletConnect from './components/WalletConnect'
import TokenTransfer from './components/TokenTransfer'
import ApproveAndTransfer from './components/ApproveAndTransfer'

const queryClient = new QueryClient()

function App() {
  return (
    <WagmiConfig config={config}>
      <QueryClientProvider client={queryClient}>
        <div className="container">
          <h1>🦊 Wagmi MetaMask 연동 테스트</h1>
          
          <WalletConnect />
          
          <div className="section">
            <h2>🚀 Transfer</h2>
            <TokenTransfer />
          </div>
          
          <div className="section">
            <h2>🛂 Approve + TransferFrom</h2>
            <ApproveAndTransfer />
          </div>
        </div>
      </QueryClientProvider>
    </WagmiConfig>
  )
}

export default App 