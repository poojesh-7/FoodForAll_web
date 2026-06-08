DROP TRIGGER IF EXISTS trg_incident_postmortems_immutable ON incident_postmortems;
DROP TRIGGER IF EXISTS trg_incident_notes_immutable ON incident_notes;
DROP TRIGGER IF EXISTS trg_incident_events_immutable ON incident_events;
DROP TRIGGER IF EXISTS trg_incident_records_immutable ON incident_records;

DROP FUNCTION IF EXISTS prevent_incident_management_mutation();

DROP TABLE IF EXISTS incident_events;
DROP TABLE IF EXISTS incident_postmortems;
DROP TABLE IF EXISTS incident_notes;
DROP TABLE IF EXISTS incident_records;
