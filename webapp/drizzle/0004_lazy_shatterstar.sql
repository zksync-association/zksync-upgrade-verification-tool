-- First, we crate the new row to contain the calls as a json array.
ALTER TABLE "emergency_proposals" ADD COLUMN "calls" json;

-- Then we initialize the data from the all columns. The final structure is: Array<{target: hex, value: hex, data: hex}>.
UPDATE "emergency_proposals" ep
SET
	calls=JSON(CONCAT(
	'[{"target": "0x',
		encode(sq.target_address, 'hex'),
	'", "value": "0x',
	    to_hex(sq.value),
	'", "data": "0x',
	    encode(sq.calldata, 'hex'),
	'"}]'
	)) -- `[{"target", "0x${targetAddress}", "value": "0x${value}", "data": "0x${calldata}"}]`
FROM (SELECT id, target_address, "value", calldata FROM emergency_proposals ep) as sq
WHERE
  ep.id=sq.id;

-- Finally, with the data already initialized the column can set to not null.
ALTER TABLE "emergency_proposals" ALTER COLUMN "calls" SET NOT NULL;

-- Lastly, we removed the old columns
ALTER TABLE "emergency_proposals" DROP COLUMN "calldata";
ALTER TABLE "emergency_proposals" DROP COLUMN IF EXISTS "target_address";
ALTER TABLE "emergency_proposals" DROP COLUMN IF EXISTS "value";



