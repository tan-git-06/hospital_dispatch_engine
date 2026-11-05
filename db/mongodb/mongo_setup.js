// =====================================================================
// MongoDB layer: collections + validators + indexes + seed + aggregations
// Run:  mongosh "mongodb://localhost:27017" --file mongo_setup.js
//
// WHY MongoDB (justification for the report):
//  * vehicle GPS pings: very high write rate, schema-flexible, time-expiring
//    -> poor fit for relational rows, ideal for documents + TTL index.
//  * "nearest available ambulance": needs geospatial index (2dsphere) and
//    $geoNear -- native in MongoDB, awkward in MySQL.
//  * dispatch audit log: append-only events whose payload differs per event
//    type -> flexible documents.
//  * patient vitals: variable measurements per patient/visit + free-text
//    notes -> document model + text index.
//  MySQL stays the source of truth for beds, patients, vehicles, dispatches.
// =====================================================================
const dbn = db.getSiblingDB('hospital_dispatch_nosql');

['vehicle_live', 'vehicle_telemetry', 'dispatch_events', 'patient_vitals'].forEach(c => dbn[c].drop());

const point = {
  bsonType: 'object', required: ['type', 'coordinates'],
  properties: {
    type: { enum: ['Point'] },
    coordinates: { bsonType: 'array', minItems: 2, maxItems: 2, items: { bsonType: 'number' } }
  }
};

// ---------- 1. vehicle_live : ONE document per vehicle (latest position) ----------
dbn.createCollection('vehicle_live', { validator: { $jsonSchema: {
  bsonType: 'object',
  required: ['vehicle_id', 'registration_no', 'vehicle_type', 'status', 'location', 'updated_at'],
  properties: {
    vehicle_id: { bsonType: 'number' },                       // FK -> MySQL vehicle.vehicle_id
    registration_no: { bsonType: 'string' },
    vehicle_type: { enum: ['BLS', 'ALS', 'ICU', 'Neonatal'] },
    status: { enum: ['Available', 'Dispatched', 'Maintenance'] },
    location: point,
    speed_kmph: { bsonType: 'number', minimum: 0, maximum: 220 },
    heading: { bsonType: 'number', minimum: 0, maximum: 360 },
    updated_at: { bsonType: 'date' }
  } } } });
dbn.vehicle_live.createIndex({ location: '2dsphere' });                  // $geoNear
dbn.vehicle_live.createIndex({ vehicle_id: 1 }, { unique: true });
dbn.vehicle_live.createIndex({ status: 1, vehicle_type: 1 });

// ---------- 2. vehicle_telemetry : append-only history, auto-deleted after 7 days ----------
dbn.createCollection('vehicle_telemetry', { validator: { $jsonSchema: {
  bsonType: 'object', required: ['vehicle_id', 'location', 'recorded_at'],
  properties: {
    vehicle_id: { bsonType: 'number' }, location: point,
    speed_kmph: { bsonType: 'number', minimum: 0, maximum: 220 },
    heading: { bsonType: 'number', minimum: 0, maximum: 360 },
    recorded_at: { bsonType: 'date' }
  } } } });
dbn.vehicle_telemetry.createIndex({ vehicle_id: 1, recorded_at: -1 });
dbn.vehicle_telemetry.createIndex({ recorded_at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });   // TTL

// ---------- 3. dispatch_events : audit trail, flexible payload ----------
dbn.createCollection('dispatch_events', { validator: { $jsonSchema: {
  bsonType: 'object', required: ['event_type', 'actor', 'created_at'],
  properties: {
    request_id: { bsonType: ['number', 'null'] },             // FK -> dispatch_request (optional)
    call_id: { bsonType: ['number', 'null'] },
    event_type: { enum: ['CALL_RECEIVED', 'VEHICLE_ASSIGNED', 'STATUS_CHANGED',
                         'PATIENT_ADMITTED', 'PATIENT_DISCHARGED', 'DISPATCH_FAILED'] },
    actor: { bsonType: 'string' },
    payload: { bsonType: 'object' },                          // shape differs per event type
    created_at: { bsonType: 'date' }
  } } } });
dbn.dispatch_events.createIndex({ request_id: 1, created_at: 1 });
dbn.dispatch_events.createIndex({ event_type: 1, created_at: -1 });

// ---------- 4. patient_vitals : variable measurements + free text ----------
dbn.createCollection('patient_vitals', { validator: { $jsonSchema: {
  bsonType: 'object', required: ['patient_id', 'recorded_at'],
  properties: {
    patient_id: { bsonType: 'number' },                       // FK -> MySQL patient.patient_id
    vitals: { bsonType: 'object', properties: {
      heart_rate: { bsonType: 'number', minimum: 0, maximum: 300 },
      spo2: { bsonType: 'number', minimum: 0, maximum: 100 },
      bp_systolic: { bsonType: 'number' }, bp_diastolic: { bsonType: 'number' },
      temp_c: { bsonType: 'number', minimum: 25, maximum: 45 },
      resp_rate: { bsonType: 'number' } } },
    symptoms: { bsonType: 'array', items: { bsonType: 'string' } },
    notes: { bsonType: 'string' },
    recorded_at: { bsonType: 'date' }
  } } } });
dbn.patient_vitals.createIndex({ patient_id: 1, recorded_at: -1 });
dbn.patient_vitals.createIndex({ notes: 'text', symptoms: 'text' });     // full-text search

// ============================== SEED ==================================
const now = new Date();
const fleet = [   // matches MySQL vehicle rows 1..10 (vehicle 2 is on a live dispatch)
  [1, 'KA01AB1001', 'ICU', 'Available', 77.5946, 12.9716], [2, 'KA01AB1002', 'ALS', 'Dispatched', 77.6300, 12.9780],
  [3, 'KA01AB1003', 'BLS', 'Available', 77.5900, 12.9650], [4, 'KA01AB1004', 'BLS', 'Available', 77.6000, 12.9800],
  [5, 'KA02CD2001', 'ALS', 'Available', 77.6101, 12.9345], [6, 'KA02CD2002', 'BLS', 'Available', 77.6200, 12.9300],
  [7, 'KA02CD2003', 'BLS', 'Available', 77.6000, 12.9400], [8, 'KA03EF3001', 'ICU', 'Available', 77.5970, 13.0350],
  [9, 'KA03EF3002', 'BLS', 'Available', 77.5900, 13.0400], [10, 'KA03EF3003', 'Neonatal', 'Available', 77.6000, 13.0300]
];
dbn.vehicle_live.insertMany(fleet.map(([id, reg, type, status, lng, lat]) => ({
  vehicle_id: id, registration_no: reg, vehicle_type: type, status,
  location: { type: 'Point', coordinates: [lng, lat] }, speed_kmph: 0, heading: 0, updated_at: now })));

const telemetry = [];
fleet.forEach(([id, , , , lng, lat]) => {
  for (let i = 12; i >= 1; i--) {            // 12 pings, 5 minutes apart over the last hour
    telemetry.push({
      vehicle_id: id,
      location: { type: 'Point', coordinates: [lng + (Math.random() - 0.5) * 0.01, lat + (Math.random() - 0.5) * 0.01] },
      speed_kmph: Math.round(20 + Math.random() * 40), heading: Math.round(Math.random() * 360),
      recorded_at: new Date(now.getTime() - i * 5 * 60 * 1000) });
  }
});
dbn.vehicle_telemetry.insertMany(telemetry);

dbn.dispatch_events.insertMany([
  { call_id: 7, event_type: 'CALL_RECEIVED', actor: 'dispatcher1', payload: { severity: 'Critical', pickup: 'Indiranagar 100 Feet Road' }, created_at: new Date(now - 20 * 60000) },
  { request_id: 7, call_id: 7, event_type: 'VEHICLE_ASSIGNED', actor: 'dispatcher1', payload: { vehicle_id: 2, driver_id: 1, distance_m: 2100 }, created_at: new Date(now - 15 * 60000) },
  { request_id: 7, call_id: 7, event_type: 'STATUS_CHANGED', actor: 'dispatcher1', payload: { from: 'Dispatched', to: 'En_Route' }, created_at: new Date(now - 14 * 60000) },
  { event_type: 'PATIENT_ADMITTED', actor: 'staff1', payload: { patient_id: 1, bed_id: 1, ward: 'ICU' }, created_at: new Date(now - 5 * 3600000) }
]);

// [merge] Audit history for the 6 historical SQL dispatches (03_seed.sql, requests 1-6) so the Reports page
// ("avg dispatch -> completion time per hospital") has data on a fresh install.
// request_id -> [call_id, vehicle_id, driver_id, hospital_id, days_ago, minutes_to_complete | null = cancelled]
const history = [[1,1,2,1,3,28],[2,2,1,1,3,22],[3,3,5,2,2,35],[4,4,6,2,2,41],[5,5,8,3,1,19],[6,6,3,1,1,null]];
history.forEach(([rid, cid, vid, hid, daysAgo, mins]) => {
  const start = new Date(now.getTime() - daysAgo * 86400000);
  const assigned = { request_id: rid, call_id: cid, event_type: 'VEHICLE_ASSIGNED', actor: 'dispatcher1',
    payload: { vehicle_id: vid, driver_id: 0, hospital_id: hid, geo_selected: false }, created_at: start };
  const finished = { request_id: rid, call_id: cid, event_type: 'STATUS_CHANGED', actor: 'dispatcher1',
    payload: mins === null ? { from: 'Dispatched', to: 'Cancelled' } : { from: 'Arrived', to: 'Completed' },
    created_at: new Date(start.getTime() + (mins ?? 4) * 60000) };
  dbn.dispatch_events.insertMany([assigned, finished]);
});

dbn.patient_vitals.insertMany([
  { patient_id: 1, vitals: { heart_rate: 118, spo2: 91, bp_systolic: 150, bp_diastolic: 95, temp_c: 37.2 }, symptoms: ['chest pain', 'sweating'], notes: 'Suspected myocardial infarction, ECG ordered', recorded_at: new Date(now - 290 * 60000) },
  { patient_id: 1, vitals: { heart_rate: 104, spo2: 94, bp_systolic: 140, bp_diastolic: 90, temp_c: 37.0 }, symptoms: ['chest pain'], notes: 'Responding to treatment', recorded_at: new Date(now - 120 * 60000) },
  { patient_id: 2, vitals: { heart_rate: 96, spo2: 97, bp_systolic: 120, bp_diastolic: 80 }, symptoms: ['fracture', 'swelling'], notes: 'Road accident, left femur fracture, X-ray done', recorded_at: new Date(now - 230 * 60000) },
  { patient_id: 4, vitals: { heart_rate: 110, spo2: 88, resp_rate: 28, temp_c: 38.1 }, symptoms: ['breathlessness', 'cough'], notes: 'Severe respiratory distress, oxygen started', recorded_at: new Date(now - 110 * 60000) }
]);

// ============================ AGGREGATIONS ============================
print('\n--- A1: 3 nearest AVAILABLE ICU/ALS vehicles to Indiranagar ($geoNear, 2dsphere) ---');
printjson(dbn.vehicle_live.aggregate([
  { $geoNear: { near: { type: 'Point', coordinates: [77.6408, 12.9784] }, distanceField: 'distance_m', spherical: true,
                query: { status: 'Available', vehicle_type: { $in: ['ICU', 'ALS'] } } } },
  { $limit: 3 },
  { $project: { _id: 0, vehicle_id: 1, registration_no: 1, vehicle_type: 1, distance_m: { $round: ['$distance_m', 0] } } }
]).toArray());

print('\n--- A2: average / max speed per vehicle in the last hour ($group) ---');
printjson(dbn.vehicle_telemetry.aggregate([
  { $match: { recorded_at: { $gte: new Date(Date.now() - 3600 * 1000) } } },
  { $group: { _id: '$vehicle_id', avg_speed: { $avg: '$speed_kmph' }, max_speed: { $max: '$speed_kmph' }, pings: { $sum: 1 } } },
  { $project: { vehicle_id: '$_id', _id: 0, avg_speed: { $round: ['$avg_speed', 1] }, max_speed: 1, pings: 1 } },
  { $sort: { avg_speed: -1 } }, { $limit: 5 }
]).toArray());

print('\n--- A3: audit events per type ($group + $sort) ---');
printjson(dbn.dispatch_events.aggregate([
  { $group: { _id: '$event_type', count: { $sum: 1 }, last_seen: { $max: '$created_at' } } },
  { $sort: { count: -1 } }
]).toArray());

print('\n--- A4: vitals trend per patient ($group, $first/$last, $avg) ---');
printjson(dbn.patient_vitals.aggregate([
  { $sort: { recorded_at: 1 } },
  { $group: { _id: '$patient_id', readings: { $sum: 1 }, avg_hr: { $avg: '$vitals.heart_rate' },
              first_spo2: { $first: '$vitals.spo2' }, latest_spo2: { $last: '$vitals.spo2' } } },
  { $sort: { _id: 1 } }
]).toArray());

print('\n--- A5: text search on clinical notes ---');
printjson(dbn.patient_vitals.find({ $text: { $search: 'fracture respiratory' } }, { _id: 0, patient_id: 1, notes: 1, score: { $meta: 'textScore' } })
  .sort({ score: { $meta: 'textScore' } }).toArray());
