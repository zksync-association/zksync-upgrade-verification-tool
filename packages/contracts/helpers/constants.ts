export const COUNCIL_SIZE = 12;
export const GUARDIANS_SIZE = 8;

/**
 * Derivation indexes for the council, guardians, zk-foundation and visitor roles.
 *
 * This is to be used in testing and dev environments.
 */
export const DERIVATION_INDEXES = {
  // Initial council, guardian, zk-foundation and visitor indexes
  COUNCIL_1: 0,
  GUARDIAN_1: 1,
  ZK_FOUNDATION: 2,
  VISITOR: 3,

  // Rest of council indexes
  COUNCIL_2: 4,
  COUNCIL_3: 5,
  COUNCIL_4: 6,
  COUNCIL_5: 7,
  COUNCIL_6: 8,
  COUNCIL_7: 9,
  COUNCIL_8: 10,
  COUNCIL_9: 11,
  COUNCIL_10: 12,
  COUNCIL_11: 13,
  COUNCIL_12: 14,

  // Rest of guardian indexes
  GUARDIAN_2: 15,
  GUARDIAN_3: 16,
  GUARDIAN_4: 17,
  GUARDIAN_5: 18,
  GUARDIAN_6: 19,
  GUARDIAN_7: 20,
  GUARDIAN_8: 21,

  // ZkAdmin is derived from here as well
  ZK_ADMIN: 22,
} as const;

export const COUNCIL_INDEXES = [
  DERIVATION_INDEXES.COUNCIL_1,
  DERIVATION_INDEXES.COUNCIL_2,
  DERIVATION_INDEXES.COUNCIL_3,
  DERIVATION_INDEXES.COUNCIL_4,
  DERIVATION_INDEXES.COUNCIL_5,
  DERIVATION_INDEXES.COUNCIL_6,
  DERIVATION_INDEXES.COUNCIL_7,
  DERIVATION_INDEXES.COUNCIL_8,
  DERIVATION_INDEXES.COUNCIL_9,
  DERIVATION_INDEXES.COUNCIL_10,
  DERIVATION_INDEXES.COUNCIL_11,
  DERIVATION_INDEXES.COUNCIL_12,
] as const;

export const GUARDIAN_INDEXES = [
  DERIVATION_INDEXES.GUARDIAN_1,
  DERIVATION_INDEXES.GUARDIAN_2,
  DERIVATION_INDEXES.GUARDIAN_3,
  DERIVATION_INDEXES.GUARDIAN_4,
  DERIVATION_INDEXES.GUARDIAN_5,
  DERIVATION_INDEXES.GUARDIAN_6,
  DERIVATION_INDEXES.GUARDIAN_7,
  DERIVATION_INDEXES.GUARDIAN_8,
] as const;
