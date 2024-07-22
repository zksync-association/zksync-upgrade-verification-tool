import gql from "graphql-tag";
import * as Urql from "urql";
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = {
  [_ in K]?: never;
};
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never };
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  AccountID: { input: any; output: any };
  Address: { input: any; output: any };
  AssetID: { input: any; output: any };
  BlockID: { input: any; output: any };
  Bytes: { input: any; output: any };
  Bytes32: { input: any; output: any };
  ChainID: { input: any; output: any };
  Hash: { input: any; output: any };
  HashID: { input: any; output: any };
  IntID: { input: any; output: any };
  JSON: { input: any; output: any };
  ProposalID: { input: any; output: any };
  Timestamp: { input: any; output: any };
  Uint256: { input: any; output: any };
  Upload: { input: any; output: any };
};

/** Key for use with this API.  See https://docs.tally.xyz/tally-api/welcome#request-an-api-key for how to request & use! */
export type ApiKey = {
  __typename?: "APIKey";
  /** Last four characters of original generated key */
  lastFour: Scalars["String"]["output"];
  /** User generated name to differentiate keys */
  name: Scalars["String"]["output"];
};

export type Account = {
  __typename?: "Account";
  address: Scalars["Address"]["output"];
  apiKeys?: Maybe<Array<ApiKey>>;
  bio: Scalars["String"]["output"];
  email: Scalars["String"]["output"];
  ens?: Maybe<Scalars["String"]["output"]>;
  features?: Maybe<Array<FeatureState>>;
  id: Scalars["ID"]["output"];
  isOFAC: Scalars["Boolean"]["output"];
  name: Scalars["String"]["output"];
  otherLinks?: Maybe<Array<OtherLink>>;
  picture?: Maybe<Scalars["String"]["output"]>;
  proposalsCreatedCount: Scalars["Int"]["output"];
  safes?: Maybe<Array<Scalars["AccountID"]["output"]>>;
  twitter?: Maybe<Scalars["String"]["output"]>;
  type: AccountType;
  votes: Scalars["Uint256"]["output"];
};

export type AccountProposalsCreatedCountArgs = {
  input: ProposalsCreatedCountInput;
};

export type AccountVotesArgs = {
  governorId: Scalars["AccountID"]["input"];
};

export type AccountElectionMeta = {
  __typename?: "AccountElectionMeta";
  hasRegistered: Scalars["Boolean"]["output"];
  isContender: Scalars["Boolean"]["output"];
  /** The contender's statement, set during register as candidate flow. */
  statement?: Maybe<Scalars["String"]["output"]>;
  /** The contender's title, set during register as candidate flow. */
  title?: Maybe<Scalars["String"]["output"]>;
};

export enum AccountType {
  Eoa = "EOA",
  Safe = "SAFE",
}

/** Source of data: Hexagate. All the events/threats for an executable call, along with a result describing whether the simulation was successful i.e. was Hexagate able to successfully run this action */
export type ActionThreatData = {
  __typename?: "ActionThreatData";
  events?: Maybe<Array<EventDataPoint>>;
  result: Scalars["String"]["output"];
};

/** Security check for a bundle of actions (proposal-level) */
export type ActionsSecurityCheck = {
  __typename?: "ActionsSecurityCheck";
  metadata: ActionsSecurityCheckMetadata;
  simulations: Array<TransactionSimulationV2>;
};

/** Metadata for a bundle (proposal-level) security check */
export type ActionsSecurityCheckMetadata = {
  __typename?: "ActionsSecurityCheckMetadata";
  threatAnalysis?: Maybe<ThreatAnalysis>;
};

export type AddAdminInput = {
  address: Scalars["String"]["input"];
  role: OrganizationRole;
};

export type AddressInfo = {
  __typename?: "AddressInfo";
  accounts: Array<Account>;
  address: Scalars["Address"]["output"];
  /** Account used for SIWE (auth). */
  ethAccount: Account;
};

/** Source of data: Hexagate. Action-level (executable call) analysis data point, the name is a label (e.g. SMARTCONTRACT_IMPLEMENTS_ANTI_SIMULATION_TECHNIQUES) and the result gives an indication whether or not it passed the check */
export type AnalysisDataPointV2 = {
  __typename?: "AnalysisDataPointV2";
  name: Scalars["String"]["output"];
  result: Scalars["Boolean"]["output"];
};

export type BalanceItem = {
  __typename?: "BalanceItem";
  address: Scalars["String"]["output"];
  balance: Scalars["String"]["output"];
  balance24H: Scalars["String"]["output"];
  decimals: Scalars["Int"]["output"];
  logo: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  nativeToken: Scalars["Boolean"]["output"];
  quote?: Maybe<Scalars["Float"]["output"]>;
  quote24H?: Maybe<Scalars["Float"]["output"]>;
  quoteRate?: Maybe<Scalars["Float"]["output"]>;
  quoteRate24H?: Maybe<Scalars["Float"]["output"]>;
  symbol: Scalars["String"]["output"];
  type: Scalars["String"]["output"];
};

export type Block = {
  __typename?: "Block";
  id: Scalars["BlockID"]["output"];
  number: Scalars["Int"]["output"];
  timestamp: Scalars["Timestamp"]["output"];
  ts: Scalars["Timestamp"]["output"];
};

export type BlockIdInput = {
  blockNumber: Scalars["Int"]["input"];
  chain: Scalars["ChainID"]["input"];
};

export type BlockOrTimestamp = Block | BlocklessTimestamp;

export type BlocklessTimestamp = {
  __typename?: "BlocklessTimestamp";
  timestamp: Scalars["Timestamp"]["output"];
};

export type Candidate = {
  account: Account;
  totalVoters: Scalars["Int"]["output"];
  totalVotes: Scalars["Uint256"]["output"];
  votes: Array<CandidateVote>;
};

export type CandidateVotesArgs = {
  pagination?: InputMaybe<Pagination>;
};

export type CandidateExport = {
  __typename?: "CandidateExport";
  address: Scalars["String"]["output"];
  email?: Maybe<Scalars["String"]["output"]>;
};

export enum CandidateSort {
  Alphabetical = "ALPHABETICAL",
  Random = "RANDOM",
  Votes = "VOTES",
}

export type CandidateVote = {
  __typename?: "CandidateVote";
  voter: Account;
  weight: Scalars["Uint256"]["output"];
};

export type CastVoteActionMetadata = {
  __typename?: "CastVoteActionMetadata";
  /** Address of the user casting the vote */
  address: Scalars["Address"]["output"];
  /** The amount of gas paid for the given meta transaction */
  gasPrice: Scalars["Uint256"]["output"];
  /** Address of the governor related to the vote */
  governorId: Scalars["AccountID"]["output"];
  /** ID of the proposal related to the dao */
  proposalId: Scalars["ID"]["output"];
  /** The vote support as FOR, AGAINST or ABSTAIN */
  support?: Maybe<SupportType>;
  /** Executor's generated transaction id (not the same as chain transaction id) */
  transactionID: Scalars["String"]["output"];
  /** Executor's given end date validaty of the transaction */
  validUntil: Scalars["Timestamp"]["output"];
};

/** Chain data in the models are only loaded on server startup. If changed please restart the api servers. */
export type Chain = {
  __typename?: "Chain";
  /** API url of the block explorer */
  blockExplorerAPI: Scalars["String"]["output"];
  /** Url of the block explorer */
  blockExplorerURL: Scalars["String"]["output"];
  /** Average block time in seconds. */
  blockTime: Scalars["Float"]["output"];
  /** Chain as parameter found in the eip. */
  chain: Scalars["String"]["output"];
  /** Boolean true if Covalent supports this network in it's API. */
  covalentSupport: Scalars["Boolean"]["output"];
  /** Boolean true if Cowswap supports the chain, false if it doesn't. */
  cowswapSupport: Scalars["Boolean"]["output"];
  /** Env Explorer Arg, which can be nil, is the env arg name of the key that we will use in the FE */
  envExplorerArg?: Maybe<Scalars["String"]["output"]>;
  /** Env RPC Arg, which can be nil, is the env arg name of the RPC endpoint that we will use in the FE */
  envRPCArg?: Maybe<Scalars["String"]["output"]>;
  /** gnosisServiceURL of the chain, can be empty or an string */
  gnosisServiceURL?: Maybe<Scalars["String"]["output"]>;
  /** Boolean true if Hexagate supports this network in it's API. */
  hexagateAnalysisSupport: Scalars["Boolean"]["output"];
  /** The id in eip155:chain_id */
  id: Scalars["ChainID"]["output"];
  /** Boolean true if it is a testnet, false if it's not. */
  isTestnet: Scalars["Boolean"]["output"];
  /** If chain is an L2, the L1 id in format eip155:chain_id */
  layer1Id?: Maybe<Scalars["ChainID"]["output"]>;
  /** Chain name with removed redundancy and unnecessary words. e.g.: Ethereum Rinkeby */
  mediumName: Scalars["String"]["output"];
  /** Contract address of Milkman (for Cowswap proposals). */
  milkmanContract?: Maybe<Scalars["AccountID"]["output"]>;
  /** Chain name as found in eip lists. e.g.: Ethereum Testnet Rinkeby */
  name: Scalars["String"]["output"];
  /** Data from chain native currency. */
  nativeCurrency: NativeCurrency;
  /** Chain short name as found in eip lists. The Acronym of it. e.g.: rin */
  shortName: Scalars["String"]["output"];
  /** Icon SVG of the chain logo. */
  svg?: Maybe<Scalars["String"]["output"]>;
  /** Boolean true if Tenderly supports simulations. */
  tenderlySupport: Scalars["Boolean"]["output"];
  /** Boolean true if L2 depends on L1 for voting period, false if it doesn't. */
  useLayer1VotingPeriod: Scalars["Boolean"]["output"];
};

export type ClaimAndDelegateAttempt = {
  __typename?: "ClaimAndDelegateAttempt";
  createdAt: Scalars["Timestamp"]["output"];
  delegateeId: Scalars["AccountID"]["output"];
  delegatorId: Scalars["AccountID"]["output"];
  expiry: Scalars["Uint256"]["output"];
  parameterR: Scalars["Bytes32"]["output"];
  parameterS: Scalars["Bytes32"]["output"];
  parameterV: Scalars["Uint256"]["output"];
  proof?: Maybe<Array<Scalars["String"]["output"]>>;
  tokenId: Scalars["AssetID"]["output"];
  txID: Scalars["HashID"]["output"];
};

export type Collectible = {
  __typename?: "Collectible";
  ID: Scalars["ID"]["output"];
  address: Scalars["String"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  imageURI?: Maybe<Scalars["String"]["output"]>;
  logoURI: Scalars["String"]["output"];
  metadata?: Maybe<Scalars["String"]["output"]>;
  name?: Maybe<Scalars["String"]["output"]>;
  tokenName: Scalars["String"]["output"];
  tokenSymbol: Scalars["String"]["output"];
  uri?: Maybe<Scalars["String"]["output"]>;
};

export type Confirmation = {
  __typename?: "Confirmation";
  owner: Account;
  signature: Scalars["Bytes"]["output"];
  signatureType: Scalars["String"]["output"];
  submissionDate: Scalars["Timestamp"]["output"];
};

export type Contact = {
  __typename?: "Contact";
  discord: Scalars["String"]["output"];
  email: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  twitter: Scalars["String"]["output"];
};

export type ContactInput = {
  discord: Scalars["String"]["input"];
  email: Scalars["String"]["input"];
  name: Scalars["String"]["input"];
  twitter: Scalars["String"]["input"];
};

export type Contender = Candidate & {
  __typename?: "Contender";
  account: Account;
  accountElectionMeta: AccountElectionMeta;
  id: Scalars["ID"]["output"];
  nominated: Scalars["Boolean"]["output"];
  rejected: Scalars["Boolean"]["output"];
  totalVoters: Scalars["Int"]["output"];
  totalVotes: Scalars["Uint256"]["output"];
  votes: Array<CandidateVote>;
};

export type ContenderVotesArgs = {
  pagination?: InputMaybe<Pagination>;
};

export enum ContenderFilter {
  All = "ALL",
  Qualified = "QUALIFIED",
  SeekingVotes = "SEEKING_VOTES",
}

export type ContractVerificationV2 = {
  __typename?: "ContractVerificationV2";
  isVerified: Scalars["Boolean"]["output"];
};

export type Contracts = {
  __typename?: "Contracts";
  governor: GovernorContract;
  tokens: Array<TokenContract>;
};

export type Council = {
  __typename?: "Council";
  cohortSize: Scalars["Int"]["output"];
  description: Scalars["String"]["output"];
  elections: Array<Election>;
  id: Scalars["IntID"]["output"];
  members: CouncilMembers;
  name: Scalars["String"]["output"];
  slug: Scalars["String"]["output"];
};

export type CouncilElectionsArgs = {
  pagination?: InputMaybe<Pagination>;
};

export type CouncilMembers = {
  __typename?: "CouncilMembers";
  firstCohort: Array<Account>;
  secondCohort: Array<Account>;
};

export type CovalentData = {
  __typename?: "CovalentData";
  decimals: Scalars["Int"]["output"];
  logo: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  price: Scalars["Float"]["output"];
  symbol: Scalars["String"]["output"];
};

export type CreateDaoInput = {
  description: Scalars["String"]["input"];
  /** The governors that control the DAO. */
  governors?: InputMaybe<Array<CreateGovernorInputV2>>;
  name: Scalars["String"]["input"];
  /** For DAOs that have yet to deploy governors but have tokens, use this field. DO NOT use this field if governors are defined in the `governors` field. */
  tokens?: InputMaybe<Array<CreateTokenInput>>;
};

export type CreateGovernorInput = {
  id: Scalars["AccountID"]["input"];
  kind?: InputMaybe<GovernorKind>;
  metadata?: InputMaybe<GovernorMetadataInput>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
  /** The block height at which the Governor contract was originally deployed. */
  startBlock: Scalars["Int"]["input"];
  tokenId: Scalars["AssetID"]["input"];
  type: GovernorType;
};

export type CreateGovernorInputV2 = {
  hubGovernorAccountId?: InputMaybe<Scalars["AccountID"]["input"]>;
  hubVotePoolAddress?: InputMaybe<Scalars["Address"]["input"]>;
  id: Scalars["AccountID"]["input"];
  startBlock: Scalars["Int"]["input"];
  token: CreateTokenInput;
  type: GovernorType;
};

export type CreateGovernorsInput = {
  governors: Array<CreateGovernorInput>;
  /** Organization is required when creating a new DAO with govenors and tokens */
  organization?: InputMaybe<CreateOrganizationInput>;
  /** Organization id is required when creating governors for an existing DAO */
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
  /** Tokens are required when creating a new DAO with govenors and tokens or when tokens for govenrors have not been created yet */
  tokens?: InputMaybe<Array<CreateTokenInput>>;
};

export type CreateOrganizationInput = {
  metadata?: InputMaybe<OrganizationMetadataInput>;
  name: Scalars["String"]["input"];
  uxVersion?: InputMaybe<OrgUxVersion>;
};

export type CreateProposalActionAttemptInput = {
  actor: Scalars["Address"]["input"];
  proposalId: Scalars["IntID"]["input"];
  txHash: Scalars["Hash"]["input"];
  type: ProposalActionType;
};

export type CreateProposalInput = {
  description: Scalars["String"]["input"];
  discourseURL?: InputMaybe<Scalars["String"]["input"]>;
  executableCalls: Array<ExecutableCallInput>;
  governorId: Scalars["AccountID"]["input"];
  originalId?: InputMaybe<Scalars["IntID"]["input"]>;
  simulationValue?: InputMaybe<Scalars["Uint256"]["input"]>;
  skipHexagate?: InputMaybe<Scalars["Boolean"]["input"]>;
  skipTenderly?: InputMaybe<Scalars["Boolean"]["input"]>;
  snapshotURL?: InputMaybe<Scalars["String"]["input"]>;
  title: Scalars["String"]["input"];
  txHash?: InputMaybe<Scalars["Hash"]["input"]>;
};

export type CreateSafeInput = {
  id: Scalars["AccountID"]["input"];
  name?: InputMaybe<Scalars["String"]["input"]>;
  organizationId: Scalars["IntID"]["input"];
};

export type CreateTokenInput = {
  id: Scalars["AssetID"]["input"];
  /** The block height at which the Token contract was originally deployed. */
  startBlock: Scalars["Int"]["input"];
};

export type CreateVoteAttemptInput = {
  proposalId: Scalars["IntID"]["input"];
  txHash: Scalars["Hash"]["input"];
  type: VoteType;
  voter: Scalars["Address"]["input"];
};

export type Delegate = {
  __typename?: "Delegate";
  account: Account;
  chainId?: Maybe<Scalars["ChainID"]["output"]>;
  delegatorsCount: Scalars["Int"]["output"];
  governor?: Maybe<Governor>;
  id: Scalars["IntID"]["output"];
  organization?: Maybe<Organization>;
  statement?: Maybe<DelegateStatement>;
  token?: Maybe<Token>;
  voteChanges: Array<VotingPowerChange>;
  votesCount: Scalars["Uint256"]["output"];
};

export type DelegateVotesCountArgs = {
  blockNumber?: InputMaybe<Scalars["Int"]["input"]>;
};

export type DelegateActionMetadata = {
  __typename?: "DelegateActionMetadata";
  /** Address of the user receiving the delegation */
  delegatee: Scalars["Address"]["output"];
  /** Address of the user delegating using a meta transaction action */
  from: Scalars["Address"]["output"];
  /** The amount of gas paid for the given meta transaction */
  gasPrice: Scalars["Uint256"]["output"];
  /** The DAO contract chain scoped information */
  tokenContractId: Scalars["AssetID"]["output"];
  /** Executor's generated transaction id (not the same as chain transaction id) */
  transactionId: Scalars["String"]["output"];
  /** Executor's given end date validaty of the transaction */
  validUntil: Scalars["Timestamp"]["output"];
};

export type DelegateInput = {
  address: Scalars["Address"]["input"];
  governorId?: InputMaybe<Scalars["AccountID"]["input"]>;
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
};

export type DelegateStatement = {
  __typename?: "DelegateStatement";
  address: Scalars["Address"]["output"];
  dataSource: DelegateStatementSource;
  dataSourceURL?: Maybe<Scalars["String"]["output"]>;
  discourseProfileLink?: Maybe<Scalars["String"]["output"]>;
  discourseUsername?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["IntID"]["output"];
  isSeekingDelegation?: Maybe<Scalars["Boolean"]["output"]>;
  issues?: Maybe<Array<Issue>>;
  organizationID: Scalars["IntID"]["output"];
  statement: Scalars["String"]["output"];
  statementSummary?: Maybe<Scalars["String"]["output"]>;
};

export enum DelegateStatementSource {
  Script = "script",
  User = "user",
}

export type DelegatesFiltersInput = {
  /** `address` filter in combination with `organizationId` allows fetching delegate info of this address from each chain */
  address?: InputMaybe<Scalars["Address"]["input"]>;
  governorId?: InputMaybe<Scalars["AccountID"]["input"]>;
  hasDelegators?: InputMaybe<Scalars["Boolean"]["input"]>;
  hasVotes?: InputMaybe<Scalars["Boolean"]["input"]>;
  isSeekingDelegation?: InputMaybe<Scalars["Boolean"]["input"]>;
  issueIds?: InputMaybe<Array<Scalars["IntID"]["input"]>>;
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
};

export type DelegatesInput = {
  filters: DelegatesFiltersInput;
  page?: InputMaybe<PageInput>;
  sort?: InputMaybe<DelegatesSortInput>;
};

export enum DelegatesSortBy {
  /** Sorts by total delegators. */
  Delegators = "delegators",
  /** The default sorting method. It sorts by date. */
  Id = "id",
  /** Sorts by DAO prioritization. */
  Prioritized = "prioritized",
  /** Sorts by voting power. */
  Votes = "votes",
}

export type DelegatesSortInput = {
  isDescending: Scalars["Boolean"]["input"];
  sortBy: DelegatesSortBy;
};

export type Delegation = {
  __typename?: "Delegation";
  blockNumber: Scalars["Int"]["output"];
  blockTimestamp: Scalars["Timestamp"]["output"];
  chainId: Scalars["ChainID"]["output"];
  delegate: Account;
  delegator: Account;
  id: Scalars["IntID"]["output"];
  organization: Organization;
  token: Token;
  votes: Scalars["Uint256"]["output"];
};

export type DelegationAttempt = {
  __typename?: "DelegationAttempt";
  createdAt: Scalars["Timestamp"]["output"];
  delegateeId: Scalars["AccountID"]["output"];
  delegatorId: Scalars["AccountID"]["output"];
  governanceId: Scalars["AccountID"]["output"];
  txID: Scalars["HashID"]["output"];
};

export type DelegationInput = {
  address: Scalars["Address"]["input"];
  governorId?: InputMaybe<Scalars["AccountID"]["input"]>;
  tokenId?: InputMaybe<Scalars["AssetID"]["input"]>;
};

export type DelegationsFiltersInput = {
  address: Scalars["Address"]["input"];
  governorId?: InputMaybe<Scalars["AccountID"]["input"]>;
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
};

export type DelegationsInput = {
  filters: DelegationsFiltersInput;
  page?: InputMaybe<PageInput>;
  sort?: InputMaybe<DelegationsSortInput>;
};

export enum DelegationsSortBy {
  /** The default sorting method. It sorts by date. */
  Id = "id",
  /** Sorts by voting power. */
  Votes = "votes",
}

export type DelegationsSortInput = {
  isDescending: Scalars["Boolean"]["input"];
  sortBy: DelegationsSortBy;
};

export type Election = {
  __typename?: "Election";
  accountElectionMeta: AccountElectionMeta;
  councilId: Scalars["Int"]["output"];
  id: Scalars["ID"]["output"];
  /** 2nd round of election. */
  memberRound?: Maybe<MemberRound>;
  /** 1st round of election. */
  nominationRound: NominationRound;
  /** Election number, incremental. */
  number: Scalars["Int"]["output"];
  status: ElectionStatus;
};

export type ElectionAccountElectionMetaArgs = {
  address: Scalars["String"]["input"];
};

export enum ElectionStatus {
  Complete = "COMPLETE",
  Grace = "GRACE",
  Member = "MEMBER",
  Nomination = "NOMINATION",
}

export type Eligibility = {
  __typename?: "Eligibility";
  /** Amount the account can claim from this token */
  amount?: Maybe<Scalars["Uint256"]["output"]>;
  proof?: Maybe<Array<Scalars["String"]["output"]>>;
  /** Whether the account is eligible to claim */
  status: EligibilityStatus;
  tx?: Maybe<Scalars["HashID"]["output"]>;
};

export enum EligibilityStatus {
  Claimed = "CLAIMED",
  Eligible = "ELIGIBLE",
  Noteligible = "NOTELIGIBLE",
}

/** Source of data: Hexagate. Proposal-level analysis data point (it is per executable call, but run with Hexagate Governance analysis), the name is a label (e.g. SMARTCONTRACT_IMPLEMENTS_ANTI_SIMULATION_TECHNIQUES) and the result gives an indication whether or not it passed the check */
export type EventDataPoint = {
  __typename?: "EventDataPoint";
  description: Scalars["String"]["output"];
  eventType: Scalars["String"]["output"];
  severity: Scalars["String"]["output"];
};

export type ExecutableCall = {
  __typename?: "ExecutableCall";
  calldata: Scalars["Bytes"]["output"];
  chainId: Scalars["ChainID"]["output"];
  index: Scalars["Int"]["output"];
  offchaindata?: Maybe<ExecutableCallOffchainData>;
  /** Target contract's function signature. */
  signature?: Maybe<Scalars["String"]["output"]>;
  target: Scalars["Address"]["output"];
  type?: Maybe<ExecutableCallType>;
  value: Scalars["Uint256"]["output"];
};

export type ExecutableCallInput = {
  calldata: Scalars["Bytes"]["input"];
  offchaindata?: InputMaybe<Scalars["JSON"]["input"]>;
  signature?: InputMaybe<Scalars["String"]["input"]>;
  target: Scalars["Address"]["input"];
  type: ExecutableCallType;
  value: Scalars["Uint256"]["input"];
};

export type ExecutableCallOffchainData = ExecutableCallRewards | ExecutableCallSwap;

export type ExecutableCallRewards = {
  __typename?: "ExecutableCallRewards";
  contributorFee: Scalars["Int"]["output"];
  recipients: Array<Scalars["String"]["output"]>;
  tallyFee: Scalars["Int"]["output"];
};

export type ExecutableCallSwap = {
  __typename?: "ExecutableCallSwap";
  /** Sell amount for the swap. */
  amountIn: Scalars["Uint256"]["output"];
  buyToken: TokenData;
  /** Tally fee */
  fee?: Maybe<Scalars["Uint256"]["output"]>;
  /** Order if the proposal is executed. */
  order?: Maybe<SwapOrder>;
  priceChecker: PriceChecker;
  /** Quote if no order exists yet. */
  quote?: Maybe<SwapQuote>;
  sellToken: TokenData;
  to: Scalars["AccountID"]["output"];
};

export enum ExecutableCallType {
  Custom = "custom",
  Empty = "empty",
  Erc20transfer = "erc20transfer",
  Erc20transferarbitrum = "erc20transferarbitrum",
  Nativetransfer = "nativetransfer",
  Orcamanagepod = "orcamanagepod",
  Other = "other",
  Reward = "reward",
  Swap = "swap",
}

export type FeatureState = {
  __typename?: "FeatureState";
  account?: Maybe<Account>;
  enabled: Scalars["Boolean"]["output"];
  governor?: Maybe<Governor>;
  name: Scalars["String"]["output"];
  organization?: Maybe<Organization>;
};

/** The `File` type, represents the response of uploading a file. */
export type File = {
  __typename?: "File";
  contentType: Scalars["String"]["output"];
  id: Scalars["String"]["output"];
  metadata: Image;
  name: Scalars["String"]["output"];
  url: Scalars["String"]["output"];
};

export type ForumActivity = {
  __typename?: "ForumActivity";
  topics: Array<ForumTopic>;
};

export type ForumTopic = {
  __typename?: "ForumTopic";
  bumpedAt?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["String"]["output"];
  fancyTitle?: Maybe<Scalars["String"]["output"]>;
  highestPostNumber?: Maybe<Scalars["Int"]["output"]>;
  imageUrl?: Maybe<Scalars["String"]["output"]>;
  lastPostedAt: Scalars["String"]["output"];
  likeCount: Scalars["Int"]["output"];
  originalPosterAvatarTemplate?: Maybe<Scalars["String"]["output"]>;
  originalPosterName?: Maybe<Scalars["String"]["output"]>;
  originalPosterUsername?: Maybe<Scalars["String"]["output"]>;
  pinned?: Maybe<Scalars["Boolean"]["output"]>;
  postsCount: Scalars["Int"]["output"];
  replyCount: Scalars["Int"]["output"];
  slug?: Maybe<Scalars["String"]["output"]>;
  title: Scalars["String"]["output"];
  views: Scalars["Int"]["output"];
};

export type GnosisSafe = {
  __typename?: "GnosisSafe";
  /** Values of all Tokens in this Gnosis Safe */
  balance?: Maybe<Treasury>;
  collectibles?: Maybe<Array<Maybe<Collectible>>>;
  /** GnosisSafe smart contract AccountID. */
  id: Scalars["AccountID"]["output"];
  /** GnosisSafe name to help distinguish it. */
  name?: Maybe<Scalars["String"]["output"]>;
  /** A counter of the amount of transactions executed on the safe. */
  nonce?: Maybe<Scalars["Int"]["output"]>;
  /** A list of owner Accounts.  The Account includes participations, but we haven't included gnosis safe owners or signers in the participations yet. */
  owners?: Maybe<Array<Account>>;
  /** The amount of confirmations (owner signatures) that are required to execute a transaction. */
  threshold?: Maybe<Scalars["Int"]["output"]>;
  /** GnosisSafe smart contract version. */
  version?: Maybe<Scalars["String"]["output"]>;
};

/** A transaction can be `SUBMITTED` or `EXECUTED`. An `EXECUTED` transaction will include a block and an on chain txHashID. */
export type GnosisSafeTransaction = {
  __typename?: "GnosisSafeTransaction";
  /** `Block` at which this safe transaction was executed. */
  block?: Maybe<Block>;
  /** All the owners that have signed the transaction. */
  confirmations: Array<Confirmation>;
  /** Chain scoped safeTxHash- https://github.com/safe-global/safe-contracts/blob/da66b45ec87d2fb6da7dfd837b29eacdb9a604c5/contracts/GnosisSafe.sol#L353-L394. */
  id: Scalars["HashID"]["output"];
  /** Current counter of multisig transactions executed on this safe.  No two transactions on this contract will have the same `nonce`. */
  nonce?: Maybe<Scalars["Uint256"]["output"]>;
  /** `GnosisSafe` smart contract AccountID. */
  safeID: Scalars["AccountID"]["output"];
  /** Chain scoped safeTxHash- https://github.com/safe-global/safe-contracts/blob/da66b45ec87d2fb6da7dfd837b29eacdb9a604c5/contracts/GnosisSafe.sol#L353-L394. */
  safeTxHashID?: Maybe<Scalars["HashID"]["output"]>;
  /** Executed transaction verified signatures. */
  signatures?: Maybe<Scalars["Bytes"]["output"]>;
  /** A list of all states the transaction has been through with a timestamp.  A transaction can be `SUBMITTED` or `EXECUTED`.  Similar to a governor proposal. */
  statusChanges: Array<GnosisStatusChange>;
  /** Ethereum transaction hash of the executed transaction. */
  txHashID?: Maybe<Scalars["HashID"]["output"]>;
};

export type GnosisSafesInput = {
  organizationIds?: InputMaybe<Array<Scalars["IntID"]["input"]>>;
};

export type GnosisStatusChange = {
  __typename?: "GnosisStatusChange";
  timestamp: Scalars["Timestamp"]["output"];
  type: GnosisStatusChangeType;
};

export enum GnosisStatusChangeType {
  Executed = "EXECUTED",
  Submitted = "SUBMITTED",
}

export type Governor = {
  __typename?: "Governor";
  chainId: Scalars["ChainID"]["output"];
  contracts: Contracts;
  delegatesCount: Scalars["Int"]["output"];
  delegatesVotesCount: Scalars["Uint256"]["output"];
  features?: Maybe<Array<FeatureState>>;
  id: Scalars["AccountID"]["output"];
  isBehind: Scalars["Boolean"]["output"];
  isIndexing: Scalars["Boolean"]["output"];
  isPrimary: Scalars["Boolean"]["output"];
  kind: GovernorKind;
  /** Last block that Tally has indexed.  Sometimes our indexer needs to catch up.  Our indexer is usually ~1min behind depending on chain so we don't serve data that might later be reorged. */
  lastIndexedBlock: Block;
  metadata?: Maybe<GovernorMetadata>;
  /** Tally name of the governor contract */
  name: Scalars["String"]["output"];
  organization: Organization;
  parameters: GovernorParameters;
  proposalStats: ProposalStats;
  /** The minumum amount of votes (total or for depending on type) that are currently required to pass a proposal. */
  quorum: Scalars["Uint256"]["output"];
  /** Tally slug used for this goverance: tally.xyz/gov/[slug] */
  slug: Scalars["String"]["output"];
  /** Chain scoped address of the timelock contract for this governor if it exists. */
  timelockId?: Maybe<Scalars["AccountID"]["output"]>;
  token: Token;
  tokenId: Scalars["AssetID"]["output"];
  tokenOwnersCount: Scalars["Int"]["output"];
  type: GovernorType;
};

export type GovernorContract = {
  __typename?: "GovernorContract";
  address: Scalars["Address"]["output"];
  lastBlock: Scalars["Int"]["output"];
  type: GovernorType;
};

export type GovernorInput = {
  id?: InputMaybe<Scalars["AccountID"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
};

export enum GovernorKind {
  Hub = "hub",
  Multiother = "multiother",
  Multiprimary = "multiprimary",
  Multisecondary = "multisecondary",
  Single = "single",
  Spoke = "spoke",
}

export type GovernorMetadata = {
  __typename?: "GovernorMetadata";
  description?: Maybe<Scalars["String"]["output"]>;
};

export type GovernorMetadataInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
};

export type GovernorParameters = {
  __typename?: "GovernorParameters";
  clockMode?: Maybe<Scalars["String"]["output"]>;
  fullWeightDuration?: Maybe<Scalars["Uint256"]["output"]>;
  gracePeriod?: Maybe<Scalars["Uint256"]["output"]>;
  nomineeVettingDuration?: Maybe<Scalars["Uint256"]["output"]>;
  proposalThreshold?: Maybe<Scalars["Uint256"]["output"]>;
  quorumDenominator?: Maybe<Scalars["Uint256"]["output"]>;
  quorumNumerator?: Maybe<Scalars["Uint256"]["output"]>;
  quorumVotes?: Maybe<Scalars["Uint256"]["output"]>;
  votingDelay?: Maybe<Scalars["Uint256"]["output"]>;
  votingPeriod?: Maybe<Scalars["Uint256"]["output"]>;
};

export enum GovernorType {
  Aave = "aave",
  Governoralpha = "governoralpha",
  Governorbravo = "governorbravo",
  Hub = "hub",
  Memberelection = "memberelection",
  Nomineeelection = "nomineeelection",
  Nounsfork = "nounsfork",
  Openzeppelingovernor = "openzeppelingovernor",
  Spoke = "spoke",
}

export type GovernorsFiltersInput = {
  excludeSecondary?: InputMaybe<Scalars["Boolean"]["input"]>;
  includeInactive?: InputMaybe<Scalars["Boolean"]["input"]>;
  organizationId: Scalars["IntID"]["input"];
};

export type GovernorsInput = {
  filters: GovernorsFiltersInput;
  page?: InputMaybe<PageInput>;
  sort?: InputMaybe<GovernorsSortInput>;
};

export enum GovernorsSortBy {
  /** The default sorting method. It sorts by date. */
  Id = "id",
}

export type GovernorsSortInput = {
  isDescending: Scalars["Boolean"]["input"];
  sortBy: GovernorsSortBy;
};

export type IdentitiesInput = {
  twitter?: InputMaybe<TwitterIdentity>;
};

export type Image = {
  __typename?: "Image";
  thumbnail?: Maybe<Scalars["String"]["output"]>;
  url?: Maybe<Scalars["String"]["output"]>;
};

export type Issue = {
  __typename?: "Issue";
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["IntID"]["output"];
  name?: Maybe<Scalars["String"]["output"]>;
  organizationId?: Maybe<Scalars["IntID"]["output"]>;
};

export type IssueInput = {
  description: Scalars["String"]["input"];
  name: Scalars["String"]["input"];
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
};

export type IssuesFiltersInput = {
  governanceId?: InputMaybe<Scalars["AccountID"]["input"]>;
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
};

export type IssuesInput = {
  filters?: InputMaybe<IssuesFiltersInput>;
};

export type JoinOrganizationInput = {
  id: Scalars["IntID"]["input"];
  password?: InputMaybe<Scalars["String"]["input"]>;
};

export type LinkGovernorInput = {
  id: Scalars["AccountID"]["input"];
  organizationId: Scalars["IntID"]["input"];
};

export type Member = {
  __typename?: "Member";
  account: Account;
  id: Scalars["ID"]["output"];
  organization: Organization;
  role: OrganizationRole;
};

export type MemberRound = Round & {
  __typename?: "MemberRound";
  availableVotes: Scalars["Uint256"]["output"];
  end: Block;
  fullWeightDuration: Scalars["Uint256"]["output"];
  id: Scalars["ProposalID"]["output"];
  nominees: Array<Nominee>;
  start: Block;
  status: RoundStatus;
  votesToWeight: Scalars["Uint256"]["output"];
};

export type MemberRoundAvailableVotesArgs = {
  address: Scalars["String"]["input"];
};

export type MemberRoundNomineesArgs = {
  pagination?: InputMaybe<Pagination>;
  sort?: InputMaybe<CandidateSort>;
};

export type MemberRoundVotesToWeightArgs = {
  votes: Scalars["Uint256"]["input"];
};

export type MetaTransaction = {
  __typename?: "MetaTransaction";
  action: MetaTransactionAction;
  address: Scalars["Address"]["output"];
  createdAt: Scalars["Timestamp"]["output"];
  governorId: Scalars["AccountID"]["output"];
  id: Scalars["ID"]["output"];
  metadata: MetaTransactionActionMetadata;
};

export enum MetaTransactionAction {
  CastVote = "CAST_VOTE",
  Delegate = "DELEGATE",
}

export type MetaTransactionActionMetadata = CastVoteActionMetadata | DelegateActionMetadata;

export type MetaTransactionSort = {
  field?: InputMaybe<MetaTransactionSortField>;
  order?: InputMaybe<SortOrder>;
};

export enum MetaTransactionSortField {
  Created = "CREATED",
}

export type Mutation = {
  __typename?: "Mutation";
  addWhitelabelDomain: Scalars["Boolean"]["output"];
  analyticsBackfill: Scalars["Boolean"]["output"];
  archiveProposal: Scalars["Boolean"]["output"];
  /** Creates an API Key for the logged in User */
  createAPIKey: Scalars["String"]["output"];
  createCastVoteMetaTransaction: MetaTransaction;
  /** Creates a `ClaimAndDelegateAttempt` with the data called by the user. */
  createClaimAndDelegateAttempt: Scalars["Boolean"]["output"];
  createDAO: Organization;
  createDelegateMetaTransaction: MetaTransaction;
  /** Creates a `DelegationAttempt` with the user intended to delegate */
  createDelegationAttempt: Scalars["Boolean"]["output"];
  createGovernors: Organization;
  createIssue: Scalars["Boolean"]["output"];
  createOrganization: Organization;
  createProposal: Proposal;
  createProposalActionAttempt: Scalars["Boolean"]["output"];
  /** Much like governors we can add a safe to an existing DAO.  A DAO can have an unlimited amount of `GnosisSafe`s. */
  createSafe: Scalars["Boolean"]["output"];
  createSafeV2: Scalars["Boolean"]["output"];
  /** Begins indexer sync for the requested token */
  createToken: Scalars["Boolean"]["output"];
  createVoteAttempt: Scalars["Boolean"]["output"];
  deleteIssue: Scalars["Boolean"]["output"];
  deleteSync: Scalars["Boolean"]["output"];
  disableWhitelabelDomain: Scalars["Boolean"]["output"];
  ingestOFACAddresses: Scalars["Boolean"]["output"];
  /** Adds the authenticated user to the organization. */
  joinOrganization: Scalars["Boolean"]["output"];
  linkGovernor: Governor;
  login: Scalars["String"]["output"];
  loginAsSafe: Scalars["String"]["output"];
  logout: Scalars["Boolean"]["output"];
  /** pauseSync, when pause syncing events from a contrat. */
  pauseSync: Scalars["Boolean"]["output"];
  registerAsContenderAttempt: Scalars["Boolean"]["output"];
  removeAccountENS: Scalars["Boolean"]["output"];
  removeAccountTwitter: Scalars["Boolean"]["output"];
  /** This mutation is used to remove an organization by its id. It will remove the organization and all its related data. */
  removeOrganization: Scalars["Boolean"]["output"];
  removeSuperAdmin: Scalars["Boolean"]["output"];
  /** Restores the provided proposal draft as the latest proposal version */
  restoreProposalDraft: Scalars["Boolean"]["output"];
  /** ResumeSync, resumes syncing an contract. */
  resumeSync: Scalars["Boolean"]["output"];
  resync: Scalars["Boolean"]["output"];
  setArbitrumProposalExecuted: Scalars["Boolean"]["output"];
  /** SyncNewContract, used by admin/developers to try new processors */
  syncNewContract: Scalars["Boolean"]["output"];
  /** Unlinks a Safe from it's Organization for linking to other Organizations */
  unlinkGnosisSafe: Scalars["Boolean"]["output"];
  /** Updates tally stored `Account` metadata (name, bio, picture, email, identity providers, etc) */
  updateAccount: Scalars["Boolean"]["output"];
  /** Updates an Account for a user via their account id */
  updateAccountByID: Scalars["Boolean"]["output"];
  updateCandidateProfile: Scalars["Boolean"]["output"];
  updateChain: Chain;
  updateFeature: FeatureState;
  updateGovernor: Governor;
  updateOrganization: Organization;
  /** Updates the admins of organization. `remove` should be a list of member IDs. */
  updateOrganizationAdmins: Scalars["Boolean"]["output"];
  /** Updates the organization password. */
  updateOrganizationPassword: Scalars["Boolean"]["output"];
  /** Updates the voting parameters of organization. */
  updateOrganizationVotingParameters: Scalars["Boolean"]["output"];
  updateParametersOZ: Scalars["Boolean"]["output"];
  updateProposal: Proposal;
  /** We are able to use updateSafe to change a gnosis safe name. */
  updateSafe: Scalars["Boolean"]["output"];
  upload: File;
  upsertDelegateProfile: DelegateStatement;
};

export type MutationAddWhitelabelDomainArgs = {
  domain: Scalars["String"]["input"];
};

export type MutationArchiveProposalArgs = {
  originalId: Scalars["IntID"]["input"];
};

export type MutationCreateApiKeyArgs = {
  name?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationCreateCastVoteMetaTransactionArgs = {
  address: Scalars["Address"]["input"];
  gasPrice: Scalars["Uint256"]["input"];
  governorId: Scalars["AccountID"]["input"];
  proposalId: Scalars["ID"]["input"];
  support: SupportType;
  transactionId: Scalars["String"]["input"];
  validUntil: Scalars["Timestamp"]["input"];
};

export type MutationCreateClaimAndDelegateAttemptArgs = {
  delegateeId: Scalars["AccountID"]["input"];
  delegatorId: Scalars["AccountID"]["input"];
  expiry: Scalars["Uint256"]["input"];
  parameterR: Scalars["Bytes32"]["input"];
  parameterS: Scalars["Bytes32"]["input"];
  parameterV: Scalars["Uint256"]["input"];
  proof?: InputMaybe<Array<Scalars["String"]["input"]>>;
  tokenId: Scalars["AssetID"]["input"];
  txID: Scalars["HashID"]["input"];
};

export type MutationCreateDaoArgs = {
  input: CreateDaoInput;
};

export type MutationCreateDelegateMetaTransactionArgs = {
  address: Scalars["Address"]["input"];
  delegatee: Scalars["Address"]["input"];
  from: Scalars["Address"]["input"];
  gasPrice: Scalars["Uint256"]["input"];
  governorId: Scalars["AccountID"]["input"];
  tokenContractId: Scalars["AssetID"]["input"];
  transactionId: Scalars["String"]["input"];
  validUntil: Scalars["Timestamp"]["input"];
};

export type MutationCreateDelegationAttemptArgs = {
  delegateeId: Scalars["AccountID"]["input"];
  delegatorId: Scalars["AccountID"]["input"];
  governanceId?: InputMaybe<Scalars["AccountID"]["input"]>;
  tokenId?: InputMaybe<Scalars["AssetID"]["input"]>;
  txID: Scalars["Bytes32"]["input"];
};

export type MutationCreateGovernorsArgs = {
  input: CreateGovernorsInput;
};

export type MutationCreateIssueArgs = {
  input: IssueInput;
};

export type MutationCreateOrganizationArgs = {
  input: CreateOrganizationInput;
};

export type MutationCreateProposalArgs = {
  input: CreateProposalInput;
};

export type MutationCreateProposalActionAttemptArgs = {
  input: CreateProposalActionAttemptInput;
};

export type MutationCreateSafeArgs = {
  id: Scalars["AccountID"]["input"];
  name?: InputMaybe<Scalars["String"]["input"]>;
  organization: Scalars["ID"]["input"];
};

export type MutationCreateSafeV2Args = {
  input: CreateSafeInput;
};

export type MutationCreateTokenArgs = {
  id: Scalars["AssetID"]["input"];
  start: Scalars["Int"]["input"];
};

export type MutationCreateVoteAttemptArgs = {
  input: CreateVoteAttemptInput;
};

export type MutationDeleteIssueArgs = {
  issueId: Scalars["IntID"]["input"];
};

export type MutationDeleteSyncArgs = {
  accountID: Scalars["AccountID"]["input"];
};

export type MutationDisableWhitelabelDomainArgs = {
  domain: Scalars["String"]["input"];
};

export type MutationJoinOrganizationArgs = {
  input: JoinOrganizationInput;
};

export type MutationLinkGovernorArgs = {
  input: LinkGovernorInput;
};

export type MutationLoginArgs = {
  message: Scalars["String"]["input"];
  signature: Scalars["String"]["input"];
};

export type MutationLoginAsSafeArgs = {
  id?: InputMaybe<Scalars["AccountID"]["input"]>;
};

export type MutationPauseSyncArgs = {
  id: Scalars["AccountID"]["input"];
};

export type MutationRegisterAsContenderAttemptArgs = {
  address: Scalars["String"]["input"];
  councilSlug: Scalars["String"]["input"];
  electionNumber: Scalars["Int"]["input"];
  email?: InputMaybe<Scalars["String"]["input"]>;
  hash: Scalars["String"]["input"];
  statement?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationRemoveAccountEnsArgs = {
  id: Scalars["AccountID"]["input"];
};

export type MutationRemoveAccountTwitterArgs = {
  id: Scalars["AccountID"]["input"];
};

export type MutationRemoveOrganizationArgs = {
  input: RemoveOrgsInput;
};

export type MutationRemoveSuperAdminArgs = {
  input: RemoveSuperAdminInput;
};

export type MutationRestoreProposalDraftArgs = {
  id: Scalars["IntID"]["input"];
};

export type MutationResumeSyncArgs = {
  id: Scalars["AccountID"]["input"];
};

export type MutationResyncArgs = {
  input: ResyncInput;
};

export type MutationSetArbitrumProposalExecutedArgs = {
  input: SetArbitrumProposalExecutedInput;
};

export type MutationSyncNewContractArgs = {
  id: Scalars["AccountID"]["input"];
  start: Scalars["Int"]["input"];
  type: Scalars["String"]["input"];
};

export type MutationUnlinkGnosisSafeArgs = {
  id: Scalars["AccountID"]["input"];
};

export type MutationUpdateAccountArgs = {
  bio?: InputMaybe<Scalars["String"]["input"]>;
  email?: InputMaybe<Scalars["String"]["input"]>;
  identities?: InputMaybe<IdentitiesInput>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  otherLinks?: InputMaybe<Array<InputMaybe<OtherLinkInput>>>;
  picture?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationUpdateAccountByIdArgs = {
  bio?: InputMaybe<Scalars["String"]["input"]>;
  email?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["AccountID"]["input"];
  identities?: InputMaybe<IdentitiesInput>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  otherLinks?: InputMaybe<Array<InputMaybe<OtherLinkInput>>>;
  picture?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationUpdateCandidateProfileArgs = {
  address: Scalars["String"]["input"];
  councilSlug: Scalars["String"]["input"];
  electionNumber: Scalars["Int"]["input"];
  email?: InputMaybe<Scalars["String"]["input"]>;
  statement?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationUpdateChainArgs = {
  blockExplorerURL?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["ChainID"]["input"];
  rpcURL?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationUpdateFeatureArgs = {
  accountID?: InputMaybe<Scalars["AccountID"]["input"]>;
  governanceID?: InputMaybe<Scalars["AccountID"]["input"]>;
  name: Scalars["String"]["input"];
  organizationID?: InputMaybe<Scalars["ID"]["input"]>;
  value: Scalars["Boolean"]["input"];
};

export type MutationUpdateGovernorArgs = {
  input: UpdateGovernorInput;
};

export type MutationUpdateOrganizationArgs = {
  input: UpdateOrganizationInput;
};

export type MutationUpdateOrganizationAdminsArgs = {
  input: OrganizationAdminsInput;
};

export type MutationUpdateOrganizationPasswordArgs = {
  input: OrganizationPasswordInput;
};

export type MutationUpdateOrganizationVotingParametersArgs = {
  input: OrganizationVotingParametersInput;
};

export type MutationUpdateProposalArgs = {
  input: UpdateProposalInput;
};

export type MutationUpdateSafeArgs = {
  id: Scalars["AccountID"]["input"];
  name: Scalars["String"]["input"];
};

export type MutationUploadArgs = {
  file: UploadFile;
};

export type MutationUpsertDelegateProfileArgs = {
  input: UpsertDelegateProfileInput;
};

export type NativeCurrency = {
  __typename?: "NativeCurrency";
  /** Decimals of the Currency. e.g.: 18 */
  decimals: Scalars["Int"]["output"];
  /** Name of the Currency. e.g.: Ether */
  name: Scalars["String"]["output"];
  /** Symbol of the Currency. e.g.: ETH */
  symbol: Scalars["String"]["output"];
};

/** Union of all node types that are paginated. */
export type Node = Delegate | Delegation | Governor | Member | Organization | Proposal | Vote;

export type NominationRound = Round & {
  __typename?: "NominationRound";
  availableVotes: Scalars["Uint256"]["output"];
  contenderRegistrationStart: Block;
  contenders: Array<Contender>;
  end: Block;
  endNomineeVotingPeriod: Block;
  id: Scalars["ProposalID"]["output"];
  start: Block;
  status: RoundStatus;
  threshold?: Maybe<Scalars["Uint256"]["output"]>;
  vettingDuration: Scalars["Uint256"]["output"];
};

export type NominationRoundAvailableVotesArgs = {
  address: Scalars["String"]["input"];
};

export type NominationRoundContendersArgs = {
  filter?: InputMaybe<ContenderFilter>;
  pagination?: InputMaybe<Pagination>;
  sort?: InputMaybe<CandidateSort>;
};

export type Nominee = Candidate & {
  __typename?: "Nominee";
  account: Account;
  accountElectionMeta: AccountElectionMeta;
  id: Scalars["ID"]["output"];
  totalVoters: Scalars["Int"]["output"];
  totalVotes: Scalars["Uint256"]["output"];
  votes: Array<CandidateVote>;
};

export type NomineeVotesArgs = {
  pagination?: InputMaybe<Pagination>;
};

export type NonceOutput = {
  __typename?: "NonceOutput";
  /** Nonce expiration time; this is same as expirationTime in siwe message */
  expirationTime: Scalars["Timestamp"]["output"];
  /** Nonce issued time; this is same as issuedAt in siwe message */
  issuedAt: Scalars["Timestamp"]["output"];
  nonce: Scalars["String"]["output"];
  /** Pass this token as the 'Nonce' header in the login request. This is temporary until we figure out cookie usage */
  nonceToken: Scalars["String"]["output"];
};

export enum OrgUxVersion {
  Governor = "governor",
  Tokenless = "tokenless",
}

export type Organization = {
  __typename?: "Organization";
  /** Can only be accessed by a TallyAdmin or Organization Admin */
  adminData?: Maybe<OrganizationAdminData>;
  chainIds: Array<Scalars["ChainID"]["output"]>;
  creator?: Maybe<Account>;
  delegatesCount: Scalars["Int"]["output"];
  delegatesVotesCount: Scalars["Uint256"]["output"];
  features?: Maybe<Array<FeatureState>>;
  governorIds: Array<Scalars["AccountID"]["output"]>;
  hasActiveProposals: Scalars["Boolean"]["output"];
  id: Scalars["IntID"]["output"];
  metadata?: Maybe<OrganizationMetadata>;
  myRole?: Maybe<OrganizationRole>;
  name: Scalars["String"]["output"];
  proposalsCount: Scalars["Int"]["output"];
  requiresPasswordToJoin: Scalars["Boolean"]["output"];
  slug: Scalars["String"]["output"];
  /** @deprecated use `tokenOwnersCount` instead */
  tokenHoldersCount: Scalars["Int"]["output"];
  tokenIds: Array<Scalars["AssetID"]["output"]>;
  tokenOwnersCount: Scalars["Int"]["output"];
  /** Organization type, for UX purposes only. */
  uxVersion: OrgUxVersion;
  /** @deprecated use `delegatesCount` instead */
  votersCount: Scalars["Int"]["output"];
};

export type OrganizationAdminData = {
  __typename?: "OrganizationAdminData";
  contact?: Maybe<Contact>;
  password?: Maybe<Scalars["String"]["output"]>;
};

export type OrganizationAdminsInput = {
  add?: InputMaybe<Array<AddAdminInput>>;
  id: Scalars["IntID"]["input"];
  remove?: InputMaybe<Array<Scalars["ID"]["input"]>>;
};

export type OrganizationInput = {
  id?: InputMaybe<Scalars["IntID"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
};

export type OrganizationIssueInput = {
  description: Scalars["String"]["input"];
  name: Scalars["String"]["input"];
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
};

export type OrganizationIssuesInput = {
  filters?: InputMaybe<IssuesFiltersInput>;
};

export type OrganizationMembersFiltersInput = {
  organizationId: Scalars["IntID"]["input"];
  roles?: InputMaybe<Array<OrganizationRole>>;
};

export type OrganizationMembersInput = {
  filters: OrganizationMembersFiltersInput;
  page?: InputMaybe<PageInput>;
  sort?: InputMaybe<OrganizationMembersSortInput>;
};

export enum OrganizationMembersSortBy {
  Id = "id",
}

export type OrganizationMembersSortInput = {
  isDescending: Scalars["Boolean"]["input"];
  sortBy: OrganizationMembersSortBy;
};

export type OrganizationMetadata = {
  __typename?: "OrganizationMetadata";
  color?: Maybe<Scalars["String"]["output"]>;
  contact?: Maybe<Contact>;
  description?: Maybe<Scalars["String"]["output"]>;
  icon?: Maybe<Scalars["String"]["output"]>;
  /** Name of this Organization in the Karma API, also if set, it signals to the FE to fetch data from karma */
  karmaName?: Maybe<Scalars["String"]["output"]>;
  socials?: Maybe<Socials>;
};

export type OrganizationMetadataInput = {
  color?: InputMaybe<Scalars["String"]["input"]>;
  contact?: InputMaybe<ContactInput>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  icon?: InputMaybe<Scalars["String"]["input"]>;
  socials?: InputMaybe<SocialsInput>;
};

export type OrganizationPasswordInput = {
  id: Scalars["IntID"]["input"];
  password: Scalars["String"]["input"];
};

export enum OrganizationRole {
  Admin = "ADMIN",
  Member = "MEMBER",
  Superadmin = "SUPERADMIN",
}

export type OrganizationVotingParametersInput = {
  id: Scalars["IntID"]["input"];
  proposalThreshold?: InputMaybe<Scalars["Uint256"]["input"]>;
  quorum?: InputMaybe<Scalars["Uint256"]["input"]>;
  role?: InputMaybe<OrganizationRole>;
  votingPeriod?: InputMaybe<Scalars["Int"]["input"]>;
};

export type OrganizationsFiltersInput = {
  address?: InputMaybe<Scalars["Address"]["input"]>;
  chainId?: InputMaybe<Scalars["ChainID"]["input"]>;
  hasLogo?: InputMaybe<Scalars["Boolean"]["input"]>;
  /** Indicates whether the user holds any of the governance tokens associated with the organization. */
  isMember?: InputMaybe<Scalars["Boolean"]["input"]>;
  roles?: InputMaybe<Array<OrganizationRole>>;
};

export type OrganizationsInput = {
  filters?: InputMaybe<OrganizationsFiltersInput>;
  page?: InputMaybe<PageInput>;
  sort?: InputMaybe<OrganizationsSortInput>;
};

export enum OrganizationsSortBy {
  /** Sorts by live proposals and voters as on the Tally explore page. */
  Explore = "explore",
  /** The default sorting method. It sorts by date. */
  Id = "id",
  Name = "name",
}

export type OrganizationsSortInput = {
  isDescending: Scalars["Boolean"]["input"];
  sortBy: OrganizationsSortBy;
};

export type OtherLink = {
  __typename?: "OtherLink";
  label: Scalars["String"]["output"];
  value: Scalars["String"]["output"];
};

export type OtherLinkInput = {
  label: Scalars["String"]["input"];
  value: Scalars["String"]["input"];
};

/** Page metadata including pagination cursors and total count */
export type PageInfo = {
  __typename?: "PageInfo";
  /**
   * Total number of items across all pages.
   * FYI, this is not yet implemented so the value will always be 0
   */
  count?: Maybe<Scalars["Int"]["output"]>;
  /** Cursor of the first item in the page */
  firstCursor?: Maybe<Scalars["String"]["output"]>;
  /** Cursor of the last item in the page */
  lastCursor?: Maybe<Scalars["String"]["output"]>;
};

/**
 * Input to specify cursor based pagination parameters.
 * Depending on which page is being fetched, between `afterCursor` & `beforeCursor`,
 * only one's value needs to be provided
 */
export type PageInput = {
  /** Cursor to start pagination after to fetch the next page */
  afterCursor?: InputMaybe<Scalars["String"]["input"]>;
  /** Cursor to start pagination before to fetch the previous page */
  beforeCursor?: InputMaybe<Scalars["String"]["input"]>;
  /**
   * Maximum number of items per page
   * 20 is the hard limit set on the backend
   */
  limit?: InputMaybe<Scalars["Int"]["input"]>;
};

/** Wraps a list of nodes and the pagination info */
export type PaginatedOutput = {
  __typename?: "PaginatedOutput";
  /** List of nodes for the page */
  nodes: Array<Node>;
  /** Pagination information */
  pageInfo: PageInfo;
};

export type Pagination = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
};

export type PriceChecker = {
  __typename?: "PriceChecker";
  feePath: Array<Scalars["Uint256"]["output"]>;
  slippage: Scalars["Uint256"]["output"];
  tokenPath: Array<Scalars["String"]["output"]>;
  /** List of Uniswap pool ids. */
  uniPoolPath?: Maybe<Array<Scalars["String"]["output"]>>;
};

export type Proposal = {
  __typename?: "Proposal";
  block?: Maybe<Block>;
  chainId: Scalars["ChainID"]["output"];
  createdAt: Scalars["Timestamp"]["output"];
  /** `Account` that submitted this proposal onchain */
  creator?: Maybe<Account>;
  /** Delegated votes count of a given address on this proposal */
  delegateVotesCount: Scalars["Uint256"]["output"];
  /** Last block or timestamp when you can cast a vote */
  end: BlockOrTimestamp;
  /** List of state transitions for this proposal. The last `ProposalEvent` is the current state. */
  events: Array<ProposalEvent>;
  executableCalls?: Maybe<Array<ExecutableCall>>;
  governor: Governor;
  id: Scalars["IntID"]["output"];
  l1ChainId?: Maybe<Scalars["ChainID"]["output"]>;
  metadata: ProposalMetadata;
  onchainId?: Maybe<Scalars["String"]["output"]>;
  organization: Organization;
  originalId?: Maybe<Scalars["IntID"]["output"]>;
  participationType: ProposalParticipationType;
  /** `Account` that created this proposal offchain */
  proposer?: Maybe<Account>;
  quorum?: Maybe<Scalars["Uint256"]["output"]>;
  /** First block when you can cast a vote, also the time when quorum is established */
  start: BlockOrTimestamp;
  status: ProposalStatus;
  voteStats?: Maybe<Array<VoteStats>>;
};

export type ProposalDelegateVotesCountArgs = {
  address: Scalars["Address"]["input"];
};

export type ProposalParticipationTypeArgs = {
  address: Scalars["Address"]["input"];
};

export type ProposalVoteStatsArgs = {
  input?: InputMaybe<VoteStatsInput>;
};

export type ProposalActionAttempt = {
  __typename?: "ProposalActionAttempt";
  actor: Account;
  chainId: Scalars["ChainID"]["output"];
  proposal: Proposal;
  txHash: Scalars["Hash"]["output"];
  type: ProposalActionType;
};

export type ProposalActionAttemptInput = {
  proposalId: Scalars["IntID"]["input"];
  type: ProposalActionType;
};

export enum ProposalActionType {
  Cancel = "cancel",
  Execute = "execute",
  Queue = "queue",
}

export type ProposalEvent = {
  __typename?: "ProposalEvent";
  block?: Maybe<Block>;
  chainId: Scalars["ChainID"]["output"];
  createdAt: Scalars["Timestamp"]["output"];
  txHash?: Maybe<Scalars["Hash"]["output"]>;
  type: ProposalEventType;
};

export enum ProposalEventType {
  Activated = "activated",
  Callexecuted = "callexecuted",
  Canceled = "canceled",
  Created = "created",
  Defeated = "defeated",
  Drafted = "drafted",
  Executed = "executed",
  Expired = "expired",
  Extended = "extended",
  Pendingexecution = "pendingexecution",
  Queued = "queued",
  Succeeded = "succeeded",
}

export type ProposalInput = {
  governorId?: InputMaybe<Scalars["AccountID"]["input"]>;
  id?: InputMaybe<Scalars["IntID"]["input"]>;
  includeArchived?: InputMaybe<Scalars["Boolean"]["input"]>;
  isLatest?: InputMaybe<Scalars["Boolean"]["input"]>;
  /** this is not unique across governors; so must be used in combination with `governorId` */
  onchainId?: InputMaybe<Scalars["String"]["input"]>;
};

export type ProposalMetadata = {
  __typename?: "ProposalMetadata";
  /** Proposal description onchain */
  description: Scalars["String"]["output"];
  discourseURL?: Maybe<Scalars["String"]["output"]>;
  /** Time at which a proposal can be executed */
  eta?: Maybe<Scalars["Int"]["output"]>;
  ipfsHash?: Maybe<Scalars["String"]["output"]>;
  previousEnd?: Maybe<Scalars["Int"]["output"]>;
  snapshotURL?: Maybe<Scalars["String"]["output"]>;
  timelockId?: Maybe<Scalars["AccountID"]["output"]>;
  /** Proposal title: usually first line of description */
  title: Scalars["String"]["output"];
  txHash?: Maybe<Scalars["Hash"]["output"]>;
};

export enum ProposalParticipationType {
  Notdelegate = "notdelegate",
  Notvoted = "notvoted",
  Unknown = "unknown",
  Votedabstain = "votedabstain",
  Votedagainst = "votedagainst",
  Votedfor = "votedfor",
}

/** Type that describes a security check related to a saved proposal */
export type ProposalSecurityCheck = {
  __typename?: "ProposalSecurityCheck";
  createdAt: Scalars["Timestamp"]["output"];
  /** JSON metadata of the security check */
  metadata: ActionsSecurityCheck;
};

export type ProposalSecurityCheckInput = {
  executableCalls: Array<ExecutableCallInput>;
  governorId: Scalars["AccountID"]["input"];
  proposer: Scalars["AccountID"]["input"];
  value?: InputMaybe<Scalars["Uint256"]["input"]>;
};

export type ProposalStats = {
  __typename?: "ProposalStats";
  /** Total count of active proposals */
  active: Scalars["Int"]["output"];
  /** Total count of failed proposals including quorum not reached */
  failed: Scalars["Int"]["output"];
  /** Total count of passed proposals */
  passed: Scalars["Int"]["output"];
  /** Total count of proposals */
  total: Scalars["Int"]["output"];
};

export enum ProposalStatus {
  Active = "active",
  Archived = "archived",
  Callexecuted = "callexecuted",
  Canceled = "canceled",
  Defeated = "defeated",
  Draft = "draft",
  Executed = "executed",
  Expired = "expired",
  Extended = "extended",
  Pending = "pending",
  Pendingexecution = "pendingexecution",
  Queued = "queued",
  Submitted = "submitted",
  Succeeded = "succeeded",
}

export type ProposalsCreatedCountInput = {
  governorId?: InputMaybe<Scalars["AccountID"]["input"]>;
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
};

export type ProposalsFiltersInput = {
  governorId?: InputMaybe<Scalars["AccountID"]["input"]>;
  /** Only drafts can be archived; so, this works ONLY with `isDraft: true` */
  includeArchived?: InputMaybe<Scalars["Boolean"]["input"]>;
  isDraft?: InputMaybe<Scalars["Boolean"]["input"]>;
  organizationId?: InputMaybe<Scalars["IntID"]["input"]>;
  /** Address that created the proposal offchain; in other words, created the draft */
  proposer?: InputMaybe<Scalars["Address"]["input"]>;
};

export type ProposalsInput = {
  filters: ProposalsFiltersInput;
  page?: InputMaybe<PageInput>;
  sort?: InputMaybe<ProposalsSortInput>;
};

export enum ProposalsSortBy {
  /** The default sorting method. It sorts by date. */
  Id = "id",
}

export type ProposalsSortInput = {
  isDescending: Scalars["Boolean"]["input"];
  sortBy: ProposalsSortBy;
};

export type Query = {
  __typename?: "Query";
  account: Account;
  accountByEns: Account;
  accountV2: Account;
  accounts: Array<Account>;
  actionSecurityCheck: SingleActionSecurityCheck;
  actionsSecurityCheck: ActionsSecurityCheck;
  address: AddressInfo;
  /** Returns tokens that can be swapped from the governor's treasury via the Tally Swap proposal recipe. */
  availableSwaps: SwapAssets;
  balances: Array<BalanceItem>;
  /** Returns the `Block` including an actual or estimated timestamp given a `BlockID`. */
  block: Block;
  candidateEmails: Array<CandidateExport>;
  chains: Array<Maybe<Chain>>;
  claimAndDelegateAttempt?: Maybe<ClaimAndDelegateAttempt>;
  contender: Contender;
  council: Council;
  councilSlugToId: Scalars["AccountID"]["output"];
  councils: Array<Council>;
  /** Returns delegate information by an address for an organization or governor. */
  delegate?: Maybe<Delegate>;
  /** Returns a delegatee of a user, to whom this user has delegated, for a governor */
  delegatee?: Maybe<Delegation>;
  /** Returns a paginated list of delegatees of a user, to whom this user has delegated, that match the provided filters. */
  delegatees: PaginatedOutput;
  /** Returns a paginated list of delegates that match the provided filters. */
  delegates: PaginatedOutput;
  delegationAttempt?: Maybe<DelegationAttempt>;
  /** Returns a paginated list of delegators of a delegate that match the provided filters. */
  delegators: PaginatedOutput;
  election: Election;
  generateAdminToolToken: Scalars["String"]["output"];
  /** Returns any `GnosisSafe`'s info given a chain scoped `AccountID`. */
  gnosisSafe: GnosisSafe;
  gnosisSafeTransaction: GnosisSafeTransaction;
  /** Returns a list of multisig tranasctions given a safe `AccountID`.  `Pagniation` defaults to a limit of 20 transactions if no limit is provided.  There are a number of filters and ordering settings we can support, please reach out to discuss. */
  gnosisSafeTransactions: Array<GnosisSafeTransaction>;
  /** This will return a list of `GnosisSafe`s related to a DAO along with `GnosisSafe` info similar to the governances query. */
  gnosisSafes: Array<GnosisSafe>;
  gnosisSafesV2: Array<GnosisSafe>;
  /** Returns governor by ID or slug. */
  governor: Governor;
  /** Returns a paginated list of governors that match the provided filters.  Note: Tally may deactivate governors from time to time. If you wish to include those set `includeInactive` to `true`. */
  governors: PaginatedOutput;
  issues?: Maybe<Array<Maybe<Issue>>>;
  latestForumActivity: ForumActivity;
  me: Account;
  memberRound: MemberRound;
  metaTransactions?: Maybe<Array<MetaTransaction>>;
  nominationRound: NominationRound;
  nominee: Nominee;
  nonce: NonceOutput;
  /** Returns organization by ID or slug. */
  organization: Organization;
  organizationMembers: PaginatedOutput;
  organizationSlugToId: Scalars["IntID"]["output"];
  /** Returns a paginated list of organizations that match the provided filters. */
  organizations: PaginatedOutput;
  /** Returns a proposal by ID or onchainId + governorId. Also retruns latest draft version by ID. */
  proposal: Proposal;
  proposalActionAttempt: ProposalActionAttempt;
  proposalSecurityCheck: ProposalSecurityCheck;
  proposalWithVersions: Array<Proposal>;
  /** Returns a paginated list of proposals that match the provided filters. */
  proposals: PaginatedOutput;
  /** Returns a quote for a swap. */
  quoteSwap: SwapQuote;
  searchOrganization: Array<Organization>;
  token: Token;
  /** Returns all token balances of an address for a governor or organization or token */
  tokenBalances: Array<TokenBalance>;
  tokenSyncs?: Maybe<Array<TokenSync>>;
  transactionAttempts: Array<TransactionAttempt>;
  validateNewGovernor: ValidateNewGovernorOutput;
  voteAttempt?: Maybe<VoteAttempt>;
  /** Returns a paginated list of votes that match the provided filters. */
  votes: PaginatedOutput;
  whitelabelDomains?: Maybe<Array<Scalars["String"]["output"]>>;
};

export type QueryAccountArgs = {
  id: Scalars["AccountID"]["input"];
};

export type QueryAccountByEnsArgs = {
  ens: Scalars["String"]["input"];
};

export type QueryAccountV2Args = {
  id: Scalars["Address"]["input"];
};

export type QueryAccountsArgs = {
  addresses?: InputMaybe<Array<Scalars["Address"]["input"]>>;
  ids?: InputMaybe<Array<Scalars["AccountID"]["input"]>>;
};

export type QueryActionSecurityCheckArgs = {
  input: SingleActionSecurityCheckInput;
};

export type QueryActionsSecurityCheckArgs = {
  input: ProposalSecurityCheckInput;
};

export type QueryAddressArgs = {
  address: Scalars["Address"]["input"];
};

export type QueryAvailableSwapsArgs = {
  governorID: Scalars["AccountID"]["input"];
};

export type QueryBalancesArgs = {
  accountID: Scalars["AccountID"]["input"];
};

export type QueryBlockArgs = {
  id: BlockIdInput;
};

export type QueryCandidateEmailsArgs = {
  councilSlug: Scalars["String"]["input"];
  electionNumber: Scalars["Int"]["input"];
  round: Scalars["Int"]["input"];
};

export type QueryClaimAndDelegateAttemptArgs = {
  delegatorId: Scalars["AccountID"]["input"];
  tokenId: Scalars["AssetID"]["input"];
};

export type QueryContenderArgs = {
  address?: InputMaybe<Scalars["String"]["input"]>;
  councilSlug: Scalars["String"]["input"];
  electionNumber: Scalars["Int"]["input"];
  ens?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryCouncilArgs = {
  slug: Scalars["String"]["input"];
};

export type QueryCouncilSlugToIdArgs = {
  slug: Scalars["String"]["input"];
};

export type QueryCouncilsArgs = {
  tokenId: Scalars["AssetID"]["input"];
};

export type QueryDelegateArgs = {
  input: DelegateInput;
};

export type QueryDelegateeArgs = {
  input: DelegationInput;
};

export type QueryDelegateesArgs = {
  input: DelegationsInput;
};

export type QueryDelegatesArgs = {
  input: DelegatesInput;
};

export type QueryDelegationAttemptArgs = {
  delegatorId: Scalars["AccountID"]["input"];
  governanceId: Scalars["AccountID"]["input"];
};

export type QueryDelegatorsArgs = {
  input: DelegationsInput;
};

export type QueryElectionArgs = {
  councilSlug: Scalars["String"]["input"];
  number: Scalars["Int"]["input"];
};

export type QueryGnosisSafeArgs = {
  id: Scalars["AccountID"]["input"];
};

export type QueryGnosisSafeTransactionArgs = {
  safeTxHashID: Scalars["HashID"]["input"];
};

export type QueryGnosisSafeTransactionsArgs = {
  gnosisSafeId: Scalars["AccountID"]["input"];
  pagination?: InputMaybe<Pagination>;
};

export type QueryGnosisSafesArgs = {
  organizationIds?: InputMaybe<Array<Scalars["ID"]["input"]>>;
};

export type QueryGnosisSafesV2Args = {
  input?: InputMaybe<GnosisSafesInput>;
};

export type QueryGovernorArgs = {
  input: GovernorInput;
};

export type QueryGovernorsArgs = {
  input: GovernorsInput;
};

export type QueryIssuesArgs = {
  input?: InputMaybe<IssuesInput>;
};

export type QueryLatestForumActivityArgs = {
  input: OrganizationInput;
};

export type QueryMemberRoundArgs = {
  councilSlug: Scalars["String"]["input"];
  electionNumber: Scalars["Int"]["input"];
};

export type QueryMetaTransactionsArgs = {
  action: MetaTransactionAction;
  address?: InputMaybe<Scalars["Address"]["input"]>;
  governorId?: InputMaybe<Scalars["AccountID"]["input"]>;
  pagination?: InputMaybe<Pagination>;
  sort?: InputMaybe<MetaTransactionSort>;
};

export type QueryNominationRoundArgs = {
  councilSlug: Scalars["String"]["input"];
  electionNumber: Scalars["Int"]["input"];
};

export type QueryNomineeArgs = {
  address?: InputMaybe<Scalars["String"]["input"]>;
  councilSlug: Scalars["String"]["input"];
  electionNumber: Scalars["Int"]["input"];
  ens?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryOrganizationArgs = {
  input: OrganizationInput;
};

export type QueryOrganizationMembersArgs = {
  input: OrganizationMembersInput;
};

export type QueryOrganizationSlugToIdArgs = {
  slug: Scalars["String"]["input"];
};

export type QueryOrganizationsArgs = {
  input?: InputMaybe<OrganizationsInput>;
};

export type QueryProposalArgs = {
  input: ProposalInput;
};

export type QueryProposalActionAttemptArgs = {
  input: ProposalActionAttemptInput;
};

export type QueryProposalSecurityCheckArgs = {
  proposalId: Scalars["ID"]["input"];
};

export type QueryProposalWithVersionsArgs = {
  input: ProposalInput;
};

export type QueryProposalsArgs = {
  input: ProposalsInput;
};

export type QueryQuoteSwapArgs = {
  buy: Scalars["AccountID"]["input"];
  governorID: Scalars["AccountID"]["input"];
  sell: Scalars["AccountID"]["input"];
  sellAmount: Scalars["Uint256"]["input"];
};

export type QuerySearchOrganizationArgs = {
  input: SearchOrganizationInput;
};

export type QueryTokenArgs = {
  input: TokenInput;
};

export type QueryTokenBalancesArgs = {
  input: TokenBalancesInput;
};

export type QueryTokenSyncsArgs = {
  chainIds?: InputMaybe<Array<Scalars["ChainID"]["input"]>>;
};

export type QueryTransactionAttemptsArgs = {
  input: TransactionAttemptsInput;
};

export type QueryValidateNewGovernorArgs = {
  input: ValidateNewGovernorInput;
};

export type QueryVoteAttemptArgs = {
  input: VoteAttemptInput;
};

export type QueryVotesArgs = {
  input: VotesInput;
};

export type RecentParticipationStatsInput = {
  governorID: Scalars["AccountID"]["input"];
};

export type RemoveOrgsInput = {
  organizationIds: Array<Scalars["IntID"]["input"]>;
};

export type RemoveSuperAdminInput = {
  accountId: Scalars["AccountID"]["input"];
  organizationId: Scalars["IntID"]["input"];
};

export type ResyncInput = {
  governorIds: Array<Scalars["AccountID"]["input"]>;
};

export enum Role {
  Admin = "ADMIN",
  User = "USER",
}

export type Round = {
  availableVotes: Scalars["Uint256"]["output"];
  end: Block;
  id: Scalars["ProposalID"]["output"];
  start: Block;
  status: RoundStatus;
};

export type RoundAvailableVotesArgs = {
  address: Scalars["String"]["input"];
};

export enum RoundStatus {
  Active = "ACTIVE",
  Complete = "COMPLETE",
  Executed = "EXECUTED",
  Pending = "PENDING",
}

export type SafeTokenBalance = {
  __typename?: "SafeTokenBalance";
  address?: Maybe<Scalars["String"]["output"]>;
  amount: Scalars["String"]["output"];
  decimals: Scalars["Int"]["output"];
  fiat: Scalars["String"]["output"];
  logoURI: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  symbol: Scalars["String"]["output"];
};

export type SearchOrganizationFiltersInput = {
  chainId?: InputMaybe<Scalars["ChainID"]["input"]>;
};

export type SearchOrganizationInput = {
  filters?: InputMaybe<SearchOrganizationFiltersInput>;
  name: Scalars["String"]["input"];
};

export type SecurityAnalysisV2 = {
  __typename?: "SecurityAnalysisV2";
  dataPoints: Array<AnalysisDataPointV2>;
};

export type SetArbitrumProposalExecutedInput = {
  blockNumber: Scalars["Int"]["input"];
  /** unix timestamp in seconds */
  blockTimestamp: Scalars["Int"]["input"];
  proposalId: Scalars["IntID"]["input"];
  txHash: Scalars["Hash"]["input"];
};

export enum SimulationStatus {
  Failed = "failed",
  Success = "success",
}

/** Security check for a single action */
export type SingleActionSecurityCheck = {
  __typename?: "SingleActionSecurityCheck";
  metadata: SingleActionSecurityCheckMetadata;
  simulation: TransactionSimulationV2;
};

export type SingleActionSecurityCheckInput = {
  executableCall: ExecutableCallInput;
  governorId: Scalars["AccountID"]["input"];
  proposer?: InputMaybe<Scalars["AccountID"]["input"]>;
  value?: InputMaybe<Scalars["Uint256"]["input"]>;
};

/** Metadata for a single action security check */
export type SingleActionSecurityCheckMetadata = {
  __typename?: "SingleActionSecurityCheckMetadata";
  contractVerification?: Maybe<ContractVerificationV2>;
  securityAnalysis?: Maybe<SecurityAnalysisV2>;
};

export type Socials = {
  __typename?: "Socials";
  discord?: Maybe<Scalars["String"]["output"]>;
  discourse?: Maybe<Scalars["String"]["output"]>;
  others?: Maybe<Array<Maybe<OtherLink>>>;
  telegram?: Maybe<Scalars["String"]["output"]>;
  twitter?: Maybe<Scalars["String"]["output"]>;
  website?: Maybe<Scalars["String"]["output"]>;
};

export type SocialsInput = {
  discord?: InputMaybe<Scalars["String"]["input"]>;
  discourse?: InputMaybe<Scalars["String"]["input"]>;
  others?: InputMaybe<Array<InputMaybe<OtherLinkInput>>>;
  telegram?: InputMaybe<Scalars["String"]["input"]>;
  twitter?: InputMaybe<Scalars["String"]["input"]>;
  website?: InputMaybe<Scalars["String"]["input"]>;
};

export enum SortOrder {
  Asc = "ASC",
  Desc = "DESC",
}

export type SpectaQlOption = {
  key: Scalars["String"]["input"];
  value: Scalars["String"]["input"];
};

/** Vote Choice */
export enum SupportType {
  Abstain = "ABSTAIN",
  Against = "AGAINST",
  For = "FOR",
}

export type SwapAssets = {
  __typename?: "SwapAssets";
  /** List of tokens that can be bought via the Tally Swap proposal recipe. */
  buy: Array<SwapToken>;
  /** List of tokens that can be sold via the Tally Swap proposal recipe. */
  sell: Array<BalanceItem>;
};

export type SwapMetaInput = {
  __typename?: "SwapMetaInput";
  /** Tally fee */
  fee?: Maybe<Scalars["Uint256"]["output"]>;
  /** List of Uniswap pool ids, describing price checker path. */
  uniPoolPath?: Maybe<Array<Scalars["String"]["output"]>>;
};

export type SwapOrder = {
  __typename?: "SwapOrder";
  /** Address of the order smart contract. */
  address?: Maybe<Scalars["String"]["output"]>;
  /** Buy amount if status is fulfilled. */
  buyAmount?: Maybe<Scalars["Uint256"]["output"]>;
  /** CoW order id if status is fulfilled. */
  id?: Maybe<Scalars["String"]["output"]>;
  /** Status of the order. */
  status: SwapOrderStatus;
};

export enum SwapOrderStatus {
  Failed = "FAILED",
  Fulfilled = "FULFILLED",
  Pending = "PENDING",
  PendingExecution = "PENDING_EXECUTION",
}

export type SwapQuote = {
  __typename?: "SwapQuote";
  buyAmount: Scalars["Uint256"]["output"];
  buyTokenQuoteRate?: Maybe<Scalars["Float"]["output"]>;
  feeAmount: Scalars["Uint256"]["output"];
  sellAmount: Scalars["Uint256"]["output"];
  validTo: Scalars["Timestamp"]["output"];
};

export type SwapToken = {
  __typename?: "SwapToken";
  decimals: Scalars["Int"]["output"];
  id: Scalars["AccountID"]["output"];
  logo: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  symbol: Scalars["String"]["output"];
};

/** Source of data: Hexagate. actionsData is the analysis per executable call, and proposerRisk is an opiniated value from Hexagate (e.g. High)  */
export type ThreatAnalysis = {
  __typename?: "ThreatAnalysis";
  actionsData: Array<Maybe<ActionThreatData>>;
  proposerRisk: Scalars["String"]["output"];
};

export enum TimeInterval {
  All = "ALL",
  Day = "DAY",
  Hour = "HOUR",
  Month = "MONTH",
  Quarter = "QUARTER",
  Week = "WEEK",
  Year = "YEAR",
}

/** Core type that describes an onchain Token contract */
export type Token = {
  __typename?: "Token";
  /** Number of decimal places included in `Uint256` values */
  decimals: Scalars["Int"]["output"];
  /** Eligibility of an account to claim this token */
  eligibility: Eligibility;
  id: Scalars["AssetID"]["output"];
  isBehind: Scalars["Boolean"]["output"];
  isIndexing: Scalars["Boolean"]["output"];
  /** Last block that Tally has indexed.  Sometimes our indexer needs to catch up.  Our indexer is usually ~1min behind depending on chain so we don't serve data that might later be reorged. */
  lastIndexedBlock: Block;
  /** Onchain name */
  name: Scalars["String"]["output"];
  /** supply derived from `Transfer` events */
  supply: Scalars["Uint256"]["output"];
  /** Onchain symbol */
  symbol: Scalars["String"]["output"];
  /** Token contract type */
  type: TokenType;
};

/** Core type that describes an onchain Token contract */
export type TokenEligibilityArgs = {
  id: Scalars["AccountID"]["input"];
};

export type TokenBalance = {
  __typename?: "TokenBalance";
  balance: Scalars["Uint256"]["output"];
  token: Token;
};

export type TokenBalancesInput = {
  address: Scalars["Address"]["input"];
  governorID?: InputMaybe<Scalars["AccountID"]["input"]>;
  organizationID?: InputMaybe<Scalars["IntID"]["input"]>;
  tokenId?: InputMaybe<Scalars["AssetID"]["input"]>;
};

export type TokenContract = {
  __typename?: "TokenContract";
  address: Scalars["Address"]["output"];
  lastBlock: Scalars["Int"]["output"];
  type: TokenType;
};

export type TokenData = {
  __typename?: "TokenData";
  data: CovalentData;
  id: Scalars["AccountID"]["output"];
};

export type TokenInput = {
  id: Scalars["AssetID"]["input"];
};

export type TokenStats = {
  __typename?: "TokenStats";
  /** @deprecated use `delegatesVotesCount` instead */
  delegatedVotingPower: Scalars["Uint256"]["output"];
  /** @deprecated use `delegatesCount` instead */
  delegates: Scalars["Int"]["output"];
  delegatesCount: Scalars["Int"]["output"];
  delegatesVotesCount: Scalars["Uint256"]["output"];
  /** @deprecated use `ownersCount` instead */
  owners: Scalars["Int"]["output"];
  ownersCount: Scalars["Int"]["output"];
  supply: Scalars["Uint256"]["output"];
  /** @deprecated use `delegates` instead */
  voters: Scalars["Int"]["output"];
};

export type TokenSync = {
  __typename?: "TokenSync";
  id: Scalars["AssetID"]["output"];
  start: Scalars["Int"]["output"];
};

export enum TokenType {
  Erc20 = "ERC20",
  Erc20Aave = "ERC20AAVE",
  Erc721 = "ERC721",
}

export type Transaction = {
  __typename?: "Transaction";
  block: Block;
  id: Scalars["HashID"]["output"];
};

export type TransactionAttempt = {
  __typename?: "TransactionAttempt";
  address: Scalars["Address"]["output"];
  chainId: Scalars["ChainID"]["output"];
  createdAt: Scalars["Timestamp"]["output"];
  id: Scalars["HashID"]["output"];
  tokenId?: Maybe<Scalars["AssetID"]["output"]>;
  transactionType: TransactionType;
  updatedAt: Scalars["Timestamp"]["output"];
};

export type TransactionAttemptsInput = {
  address: Scalars["Address"]["input"];
  tokenId?: InputMaybe<Scalars["AssetID"]["input"]>;
  transactionType?: InputMaybe<TransactionType>;
};

/** Source of data: Tenderly. Array of simulations used for proposal-level checks */
export type TransactionSimulationArray = {
  __typename?: "TransactionSimulationArray";
  simulations: Array<TransactionSimulationV2>;
};

/** V2 */
export type TransactionSimulationV2 = {
  __typename?: "TransactionSimulationV2";
  publicURI: Scalars["String"]["output"];
  result: Scalars["String"]["output"];
};

export enum TransactionType {
  Delegation = "delegation",
}

export type Treasury = {
  __typename?: "Treasury";
  tokens: Array<SafeTokenBalance>;
  totalUSDValue: Scalars["String"]["output"];
};

export type TwitterIdentity = {
  nonce: Scalars["Int"]["input"];
  url: Scalars["String"]["input"];
};

export type UpdateGovernorInput = {
  id: Scalars["AccountID"]["input"];
  metadata?: InputMaybe<GovernorMetadataInput>;
};

export type UpdateOrganizationInput = {
  id: Scalars["IntID"]["input"];
  metadata?: InputMaybe<OrganizationMetadataInput>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateProposalInput = {
  id: Scalars["IntID"]["input"];
  status: ProposalStatus;
  txHash: Scalars["Hash"]["input"];
};

/** The `UploadFile` type, represents the request for uploading a file with a certain payload. */
export type UploadFile = {
  id: Scalars["Int"]["input"];
  upload: Scalars["Upload"]["input"];
};

export type UpsertDelegateProfileInput = {
  address?: InputMaybe<Scalars["Address"]["input"]>;
  dataSourceURL?: InputMaybe<Scalars["String"]["input"]>;
  discourseProfileLink?: InputMaybe<Scalars["String"]["input"]>;
  discourseUsername?: InputMaybe<Scalars["String"]["input"]>;
  isSeekingDelegation?: InputMaybe<Scalars["Boolean"]["input"]>;
  issueIds?: InputMaybe<Array<Scalars["IntID"]["input"]>>;
  organizationId: Scalars["IntID"]["input"];
  statement: Scalars["String"]["input"];
  statementSummary?: InputMaybe<Scalars["String"]["input"]>;
};

export type ValidateNewGovernorInput = {
  id: Scalars["AccountID"]["input"];
};

export type ValidateNewGovernorOutput = {
  __typename?: "ValidateNewGovernorOutput";
  startBlock: Scalars["Int"]["output"];
  tokenId: Scalars["AssetID"]["output"];
  tokenStartBlock: Scalars["Int"]["output"];
  type: GovernorType;
};

export type Vote = {
  __typename?: "Vote";
  amount: Scalars["Uint256"]["output"];
  block: Block;
  chainId: Scalars["ChainID"]["output"];
  id: Scalars["IntID"]["output"];
  isBridged?: Maybe<Scalars["Boolean"]["output"]>;
  proposal: Proposal;
  reason?: Maybe<Scalars["String"]["output"]>;
  txHash: Scalars["Hash"]["output"];
  type: VoteType;
  voter: Account;
};

export type VoteAttempt = {
  __typename?: "VoteAttempt";
  chainId: Scalars["ChainID"]["output"];
  createdAt: Scalars["Timestamp"]["output"];
  proposal: Proposal;
  txHash: Scalars["Hash"]["output"];
  type: VoteType;
  voter: Account;
};

export type VoteAttemptInput = {
  proposalId: Scalars["IntID"]["input"];
  voter: Scalars["Address"]["input"];
};

/** Voting Summary per Choice */
export type VoteStats = {
  __typename?: "VoteStats";
  /** Percent of votes casted for this Choice/`Votetype' */
  percent: Scalars["Float"]["output"];
  type: VoteType;
  /** Total number of distinct voters for this Choice/`VoteType` */
  votersCount: Scalars["Int"]["output"];
  /** Total votes casted for this Choice/`VoteType` */
  votesCount: Scalars["Uint256"]["output"];
};

export type VoteStatsInput = {
  includePendingVotes?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export enum VoteType {
  Abstain = "abstain",
  Against = "against",
  For = "for",
}

export type VotesFiltersInput = {
  proposalId: Scalars["IntID"]["input"];
  voter?: InputMaybe<Scalars["Address"]["input"]>;
};

export type VotesInput = {
  filters: VotesFiltersInput;
  page?: InputMaybe<PageInput>;
  sort?: InputMaybe<VotesSortInput>;
};

export type VotesSortInput = {
  isDescending: Scalars["Boolean"]["input"];
  sortBy: VotesSoryBy;
};

export enum VotesSoryBy {
  Amount = "amount",
  /** The default sorting method. It sorts by date. */
  Id = "id",
}

export type VotingParameters = {
  __typename?: "VotingParameters";
  proposalThreshold?: Maybe<Scalars["Uint256"]["output"]>;
  quorum?: Maybe<Scalars["Uint256"]["output"]>;
  /** Role user needs to have to update the voting parameters. */
  requiredRole: OrganizationRole;
  /** Voting period defined in s, defaults to 172800 (2 days). */
  votingPeriod: Scalars["Int"]["output"];
};

/** Represents a voting power change over an interval or triggered by an event. */
export type VotingPowerChange = {
  __typename?: "VotingPowerChange";
  /** The `delegate` address whose voting power is changing */
  delegate: Account;
  /** Net change in voting power caused by this event */
  netChange: Scalars["Uint256"]["output"];
  /** Voting power after this event or interval */
  newBalance: Scalars["Uint256"]["output"];
  /** Voting power prior to this event or interval */
  prevBalance: Scalars["Uint256"]["output"];
  /** Timestamp of event or beginging of the interval this voting power change represents */
  timestamp: Scalars["Timestamp"]["output"];
  token: Token;
  /** Transaction that triggered this voting change, unset if this is an interval */
  transaction?: Maybe<Transaction>;
};

export type ProposalQueryVariables = Exact<{
  proposalId: Scalars["String"]["input"];
  governorId: Scalars["AccountID"]["input"];
}>;

export type ProposalQuery = {
  __typename?: "Query";
  proposal: {
    __typename?: "Proposal";
    onchainId?: string | null;
    chainId: any;
    createdAt: any;
    l1ChainId?: any | null;
    originalId?: any | null;
    quorum?: any | null;
    status: ProposalStatus;
    governor: {
      __typename?: "Governor";
      isPrimary: boolean;
      name: string;
      quorum: any;
      type: GovernorType;
    };
    metadata: {
      __typename?: "ProposalMetadata";
      title: string;
      description: string;
      eta?: number | null;
      ipfsHash?: string | null;
      txHash?: any | null;
      discourseURL?: string | null;
      snapshotURL?: string | null;
    };
  };
};

export const ProposalDocument = gql`
    query Proposal($proposalId: String!, $governorId: AccountID!) {
  proposal(input: {onchainId: $proposalId, governorId: $governorId}) {
    onchainId
    chainId
    createdAt
    l1ChainId
    originalId
    quorum
    status
    governor {
      isPrimary
      name
      quorum
      type
    }
    metadata {
      title
      description
      eta
      ipfsHash
      txHash
      discourseURL
      snapshotURL
    }
  }
}
    `;

export function useProposalQuery(
  options: Omit<Urql.UseQueryArgs<ProposalQueryVariables>, "query">
) {
  return Urql.useQuery<ProposalQuery, ProposalQueryVariables>({
    query: ProposalDocument,
    ...options,
  });
}
