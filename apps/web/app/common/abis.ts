import { parseAbi } from "viem";

// Minimal ABIs for the calls this app makes, written out so they can be reviewed at a glance.
// Signatures match the deployed contracts (zk-governance l1-contracts) and Safe v1.3.0+.

export const upgradeHandlerAbi = parseAbi([
  "struct Call { address target; uint256 value; bytes data; }",
  "struct UpgradeProposal { Call[] calls; address executor; bytes32 salt; }",
  "function securityCouncil() view returns (address)",
  "function guardians() view returns (address)",
  "function emergencyUpgradeBoard() view returns (address)",
  "function L2_PROTOCOL_GOVERNOR() view returns (address)",
  "function upgradeState(bytes32 _id) view returns (uint8)",
  "function upgradeStatus(bytes32 _id) view returns (uint48 creationTimestamp, uint48 securityCouncilApprovalTimestamp, bool guardiansApproval, bool guardiansExtendedLegalVeto, bool executed)",
  "function protocolFrozenUntil() view returns (uint256)",
  "function lastFreezeStatusInUpgradeCycle() view returns (uint8)",
  "function startUpgrade(uint256 _l2BatchNumber, uint256 _l2MessageIndex, uint16 _l2TxNumberInBatch, bytes32[] _proof, UpgradeProposal _proposal)",
  "function execute(UpgradeProposal _proposal) payable",
  "event UpgradeStarted(bytes32 indexed _id, UpgradeProposal _proposal)",
  "event UpgradeLegalVetoExtended(bytes32 indexed _id)",
  "event UpgradeApprovedBySecurityCouncil(bytes32 indexed _id)",
  "event UpgradeApprovedByGuardians(bytes32 indexed _id)",
  "event UpgradeExecuted(bytes32 indexed _id)",
  "event EmergencyUpgradeExecuted(bytes32 indexed _id)",
  "event ChangeSecurityCouncil(address indexed _securityCouncilBefore, address indexed _securityCouncilAfter)",
  "event SoftFreeze(uint256 _protocolFrozenUntil)",
  "event HardFreeze(uint256 _protocolFrozenUntil)",
  "event Unfreeze()",
]);

// Shared by SecurityCouncil and Guardians (both extend Multisig).
const multisigItems = [
  "function PROTOCOL_UPGRADE_HANDLER() view returns (address)",
  "function members(uint256) view returns (address)",
  "function EIP1271_THRESHOLD() view returns (uint256)",
  "function checkSignatures(bytes32 _digest, address[] _signers, bytes[] _signatures, uint256 _threshold) view",
  "function isValidSignature(bytes32 _digest, bytes _signature) view returns (bytes4)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
] as const;

export const securityCouncilAbi = parseAbi([
  ...multisigItems,
  "function APPROVE_UPGRADE_SECURITY_COUNCIL_THRESHOLD() view returns (uint256)",
  "function SOFT_FREEZE_CONSERVATIVE_THRESHOLD() view returns (uint256)",
  "function HARD_FREEZE_THRESHOLD() view returns (uint256)",
  "function UNFREEZE_THRESHOLD() view returns (uint256)",
  "function softFreezeThreshold() view returns (uint256)",
  "function softFreezeNonce() view returns (uint256)",
  "function hardFreezeNonce() view returns (uint256)",
  "function unfreezeNonce() view returns (uint256)",
  "function softFreezeThresholdSettingNonce() view returns (uint256)",
  "function approveUpgradeSecurityCouncil(bytes32 _id, address[] _signers, bytes[] _signatures)",
  "function softFreeze(uint256 _validUntil, address[] _signers, bytes[] _signatures)",
  "function hardFreeze(uint256 _validUntil, address[] _signers, bytes[] _signatures)",
  "function unfreeze(uint256 _validUntil, address[] _signers, bytes[] _signatures)",
  "function setSoftFreezeThreshold(uint256 _threshold, uint256 _validUntil, address[] _signers, bytes[] _signatures)",
]);

export const guardiansAbi = parseAbi([
  ...multisigItems,
  "struct L2GovernorProposal { address[] targets; uint256[] values; bytes[] calldatas; string description; }",
  "struct TxRequest { address to; uint256 l2GasLimit; uint256 l2GasPerPubdataByteLimit; address refundRecipient; uint256 txMintValue; }",
  "function APPROVE_UPGRADE_GUARDIANS_THRESHOLD() view returns (uint256)",
  "function EXTEND_LEGAL_VETO_THRESHOLD() view returns (uint256)",
  "function CANCEL_L2_GOVERNOR_PROPOSAL_THRESHOLD() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function hashL2Proposal(L2GovernorProposal _l2Proposal) pure returns (uint256)",
  "function approveUpgradeGuardians(bytes32 _id, address[] _signers, bytes[] _signatures)",
  "function extendLegalVeto(bytes32 _id, address[] _signers, bytes[] _signatures)",
  "function cancelL2GovernorProposal(L2GovernorProposal _l2Proposal, TxRequest _txRequest, address[] _signers, bytes[] _signatures) payable",
]);

export const emergencyUpgradeBoardAbi = parseAbi([
  "struct Call { address target; uint256 value; bytes data; }",
  "function PROTOCOL_UPGRADE_HANDLER() view returns (address)",
  "function ZK_FOUNDATION_SAFE() view returns (address)",
  "function SECURITY_COUNCIL() view returns (address)",
  "function GUARDIANS() view returns (address)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function executeEmergencyUpgrade(Call[] _calls, bytes32 _salt, bytes _guardiansSignatures, bytes _securityCouncilSignatures, bytes _zkFoundationSignatures)",
]);

// Safe singleton (v1.3.0+) and CompatibilityFallbackHandler functions reachable on a Safe proxy.
export const safeAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function domainSeparator() view returns (bytes32)",
  "function signedMessages(bytes32) view returns (uint256)",
  "function getMessageHash(bytes message) view returns (bytes32)",
  "function isValidSignature(bytes32 _dataHash, bytes _signature) view returns (bytes4)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
]);

export const safeSignMessageLibAbi = parseAbi(["function signMessage(bytes _data)"]);

export const l2GovernorAbi = parseAbi([
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
  "event ProposalExecuted(uint256 proposalId)",
  "event ProposalCanceled(uint256 proposalId)",
  "function state(uint256 proposalId) view returns (uint8)",
  "function name() view returns (string)",
  "function proposalSnapshot(uint256 proposalId) view returns (uint256)",
  "function proposalDeadline(uint256 proposalId) view returns (uint256)",
  "function votingDelay() view returns (uint256)",
]);

// Used only to decode the message an L2 governor sends to L1 when it executes a proposal.
export const l1MessengerEventAbi = parseAbi([
  "event L1MessageSent(address indexed _sender, bytes32 indexed _hash, bytes _message)",
]);

export const ERC1271_MAGIC_VALUE = "0x1626ba7e" as const;

// Per-chain upgrades: read the registered cut and forward the chain owner's two actions.
const chainDiamondStructs = [
  "struct FacetCut { address facet; uint8 action; bool isFreezable; bytes4[] selectors; }",
  "struct DiamondCutData { FacetCut[] facetCuts; address initAddress; bytes initCalldata; }",
] as const;
export const chainUpgradeBridgehubAbi = parseAbi([
  "function getZKChain(uint256 _chainId) view returns (address)",
  "function chainTypeManager(uint256 _chainId) view returns (address)",
]);
export const chainUpgradeDiamondAbi = parseAbi([
  ...chainDiamondStructs,
  "function getAdmin() view returns (address)",
  "function getChainTypeManager() view returns (address)",
  "function getChainId() view returns (uint256)",
  "function getProtocolVersion() view returns (uint256)",
  "function upgradeChainFromVersion(address _chainAddress,uint256 _oldProtocolVersion,DiamondCutData _diamondCut)",
]);
export const chainUpgradeLegacyDiamondAbi = parseAbi([
  ...chainDiamondStructs,
  "function upgradeChainFromVersion(uint256 _oldProtocolVersion,DiamondCutData _diamondCut)",
]);
export const chainUpgradeCtmAbi = parseAbi([
  ...chainDiamondStructs,
  "function protocolVersion() view returns (uint256)",
  "function upgradeCutHash(uint256 _oldProtocolVersion) view returns (bytes32)",
  "function upgradeCutDataBlock(uint256 _oldProtocolVersion) view returns (uint256)",
  "function serverNotifierAddress() view returns (address)",
  "event NewUpgradeCutData(uint256 indexed protocolVersion,DiamondCutData diamondCutData)",
]);
export const chainUpgradeNotifierAbi = parseAbi([
  "function chainTypeManager() view returns (address)",
  "function protocolVersionToUpgradeTimestamp(uint256 _chainId,uint256 _oldProtocolVersion) view returns (uint256)",
  "function setUpgradeTimestamp(uint256 _chainId,uint256 _upgradeTimestamp)",
]);
export const chainUpgradeAdminAbi = parseAbi([
  "struct Call { address target; uint256 value; bytes data; }",
  "function owner() view returns (address)",
  "function multicall(Call[] _calls,bool _requireSuccess) payable",
]);
