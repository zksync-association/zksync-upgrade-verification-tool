// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

/// @title ZKsync stand-in for the Sepolia test deployment of the governance contracts
/// @notice Takes every role the ProtocolUpgradeHandler and Guardians give to ZKsync contracts (Era's
/// diamond proxy, the chain type manager, the bridgehub, the bridges, the chain asset handler), so
/// their write paths can be tried on Sepolia without touching ZKsync:
/// - proveL2MessageInclusion accepts any message, so anyone can start any upgrade;
/// - every other call (a freeze, a pause, a veto's requestL2Transaction, an upgrade's calls)
///   succeeds and is logged.
/// TEST ONLY: with it, starting an upgrade proves nothing.
contract ZKsyncTestStub {
    struct L2Message {
        uint16 txNumberInBatch;
        address sender;
        bytes data;
    }

    event Called(address indexed caller, uint256 value, bytes data);

    /// @notice Any message is "included": the handler starts whatever upgrade it is given.
    function proveL2MessageInclusion(uint256, uint256, L2Message calldata, bytes32[] calldata)
        external
        pure
        returns (bool)
    {
        return true;
    }

    /// @notice One chain, ZKsync Era Sepolia's id, so a freeze freezes (here: logs) one chain.
    function getAllZKChainChainIDs() external pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = 300;
    }

    fallback() external payable {
        emit Called(msg.sender, msg.value, msg.data);
    }

    receive() external payable {
        emit Called(msg.sender, msg.value, "");
    }
}
