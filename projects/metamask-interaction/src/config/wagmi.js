import { http, createConfig } from 'wagmi'
import { mainnet, sepolia, localhost } from 'wagmi/chains'
import { metaMask } from 'wagmi/connectors'

export const config = createConfig({
  chains: [localhost, sepolia, mainnet],
  transports: {
    [localhost.id]: http(),
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
  connectors: [
    metaMask()
  ]
})