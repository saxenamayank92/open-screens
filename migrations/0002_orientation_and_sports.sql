ALTER TABLE screens DROP CONSTRAINT IF EXISTS screens_orientation_check;
ALTER TABLE screens ADD CONSTRAINT screens_orientation_check CHECK(orientation IN ('landscape','landscape-180','portrait-cw','portrait-ccw'));
