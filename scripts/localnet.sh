#!/bin/sh
# Local validator with the real Meteora programs + accounts cloned from mainnet (same IDs as devnet).
# Unlimited airdrops; use when the public devnet faucet is rate-limited.
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
exec solana-test-validator --reset --quiet --ledger "${LEDGER:-.localnet}" -u "${CLONE_RPC:-https://api.mainnet-beta.solana.com}" \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN `# DBC` \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG `# DAMM v2` \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s `# Metaplex metadata` \
  --clone-upgradeable-program LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn `# Jupiter locker` \
  --clone-upgradeable-program LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo `# DLMM` \
  --clone FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM `# DBC pool authority (pays locker rent)` \
  --clone HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC `# DAMM v2 pool authority` \
  --clone A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck `# DAMM v2 migration config: Customizable` \
  --clone 7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd --clone 2nHK1kju6XjphBLbNxpM5XRGFj7p9U8vvNzyZiha1z6k \
  --clone Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp --clone 2c4cYd4reUYVRAB9kUUkrq55VPyy2FNQ3FDL4o12JXmq `# fixed-fee migration configs`
