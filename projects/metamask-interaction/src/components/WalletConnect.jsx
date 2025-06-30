import React from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { metaMask } from 'wagmi/connectors'

function WalletConnect() {
  const { address, isConnected } = useAccount()
  const { connect, isLoading: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()

  const handleConnect = () => {
    connect({ connector: metaMask() })
  }

  return (
    <div className="section">
      <h3>🔌 지갑 연결</h3>
      
      {isConnected ? (
        <div>
          <p className="success">지갑 연결됨: {address}</p>
          <button onClick={() => disconnect()}>
            연결 해제
          </button>
        </div>
      ) : (
        <button 
          onClick={handleConnect}
          disabled={isConnecting}
        >
          {isConnecting ? '연결 중...' : '🔌 지갑 연결'}
        </button>
      )}
    </div>
  )
}

export default WalletConnect 