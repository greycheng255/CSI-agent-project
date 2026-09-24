-- 提现实名（轻量）：给 users 表新增实名两列
-- id_card_name：身份证姓名（明文，普通人名非敏感密级）
-- id_card_number_cipher：身份证号（AES-256-GCM 加密后的密文，不落明文）
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_card_name VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_card_number_cipher TEXT;