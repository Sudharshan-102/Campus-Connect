-- =============================================================================
-- Campus Connect: graph schema (SurrealDB 3.x)
-- Applying this file is repeatable: every statement uses OVERWRITE.
--
--   NODES  : student, activity
--   EDGES  : friends_with, mentorship_request, mentors, collaborates_with, involves
-- =============================================================================

-- ----------------------------------------------------------------------------
-- NODE: student
-- ----------------------------------------------------------------------------
DEFINE TABLE OVERWRITE student SCHEMAFULL;

DEFINE FIELD OVERWRITE name       ON student TYPE string
    ASSERT string::len(string::trim($value)) >= 2 AND string::len($value) <= 60;
DEFINE FIELD OVERWRITE email      ON student TYPE string
    VALUE string::lowercase($value)
    ASSERT string::is_email($value);
DEFINE FIELD OVERWRITE department ON student TYPE string
    ASSERT $value IN ['CSE', 'ECE', 'EEE', 'IT', 'MECH', 'CIVIL'];
DEFINE FIELD OVERWRITE year       ON student TYPE int
    ASSERT $value >= 1 AND $value <= 4;
DEFINE FIELD OVERWRITE skills     ON student TYPE array<string> DEFAULT [];
DEFINE FIELD OVERWRITE interests  ON student TYPE array<string> DEFAULT [];
DEFINE FIELD OVERWRITE bio        ON student TYPE string DEFAULT ''
    ASSERT string::len($value) <= 400;
DEFINE FIELD OVERWRITE avatar     ON student TYPE string DEFAULT '';
DEFINE FIELD OVERWRITE created_at ON student TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE updated_at ON student TYPE datetime VALUE time::now();

DEFINE INDEX OVERWRITE student_email_unique ON student FIELDS email UNIQUE;

-- ----------------------------------------------------------------------------
-- EDGE: friends_with   (mutual)
-- A friendship is ONE edge. Its direction is canonical (in < out, by record id)
-- so (a)->(b) and (b)->(a) can never both exist: no duplicate logical friendship.
-- ----------------------------------------------------------------------------
DEFINE TABLE OVERWRITE friends_with TYPE RELATION IN student OUT student ENFORCED SCHEMAFULL;

DEFINE FIELD OVERWRITE in  ON friends_with TYPE record<student>;
DEFINE FIELD OVERWRITE out ON friends_with TYPE record<student>
    ASSERT $value != in AND <string>$value > <string>in;
DEFINE FIELD OVERWRITE level      ON friends_with TYPE string DEFAULT 'friend'
    ASSERT $value IN ['friend', 'close'];
DEFINE FIELD OVERWRITE created_at ON friends_with TYPE datetime DEFAULT time::now() READONLY;

DEFINE INDEX OVERWRITE friends_with_pair ON friends_with FIELDS in, out UNIQUE;

-- ----------------------------------------------------------------------------
-- EDGE: mentorship_request   (mentee)->(mentor)   the pending workflow edge
-- Status may only move OUT of 'pending' (checked by the database itself).
-- open_key is computed by the database: while pending it is "mentee>mentor",
-- otherwise NONE.  A UNIQUE index on it allows only one open request per pair.
-- ----------------------------------------------------------------------------
DEFINE TABLE OVERWRITE mentorship_request TYPE RELATION IN student OUT student ENFORCED SCHEMAFULL;

DEFINE FIELD OVERWRITE in  ON mentorship_request TYPE record<student>;
DEFINE FIELD OVERWRITE out ON mentorship_request TYPE record<student>
    ASSERT $value != in;
DEFINE FIELD OVERWRITE status ON mentorship_request TYPE string DEFAULT 'pending'
    ASSERT $value IN ['pending', 'accepted', 'rejected']
       AND ($before = NONE OR $before = $value OR $before = 'pending');
DEFINE FIELD OVERWRITE expertise    ON mentorship_request TYPE string
    ASSERT string::len(string::trim($value)) >= 2 AND string::len($value) <= 60;
DEFINE FIELD OVERWRITE message      ON mentorship_request TYPE string DEFAULT ''
    ASSERT string::len($value) <= 300;
DEFINE FIELD OVERWRITE created_at   ON mentorship_request TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE responded_at ON mentorship_request TYPE option<datetime>;
DEFINE FIELD OVERWRITE open_key     ON mentorship_request TYPE option<string>
    VALUE IF $this.status = 'pending' THEN <string>$this.in + '>' + <string>$this.out ELSE NONE END;

DEFINE INDEX OVERWRITE mentorship_request_open ON mentorship_request FIELDS open_key UNIQUE;

-- ----------------------------------------------------------------------------
-- EDGE: mentors   (mentor)->(mentee)   directional
-- Created only by the atomic accept transaction. Ended (not deleted) to keep history.
-- active_key (computed) + UNIQUE index: at most one ACTIVE mentorship per pair.
-- ----------------------------------------------------------------------------
DEFINE TABLE OVERWRITE mentors TYPE RELATION IN student OUT student ENFORCED SCHEMAFULL;

DEFINE FIELD OVERWRITE in  ON mentors TYPE record<student>;
DEFINE FIELD OVERWRITE out ON mentors TYPE record<student>
    ASSERT $value != in;
DEFINE FIELD OVERWRITE expertise  ON mentors TYPE string
    ASSERT string::len(string::trim($value)) >= 2;
DEFINE FIELD OVERWRITE status     ON mentors TYPE string DEFAULT 'active'
    ASSERT $value IN ['active', 'ended']
       AND ($before = NONE OR $before = $value OR $before = 'active');
DEFINE FIELD OVERWRITE started_at ON mentors TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE ended_at   ON mentors TYPE option<datetime>;
DEFINE FIELD OVERWRITE via_request ON mentors TYPE option<record<mentorship_request>>;
DEFINE FIELD OVERWRITE active_key ON mentors TYPE option<string>
    VALUE IF $this.status = 'active' THEN <string>$this.in + '>' + <string>$this.out ELSE NONE END;

DEFINE INDEX OVERWRITE mentors_active ON mentors FIELDS active_key UNIQUE;

-- ----------------------------------------------------------------------------
-- EDGE: collaborates_with   (mutual, canonical direction like friends_with)
-- Several projects between the same two students are allowed (unique per title).
-- ----------------------------------------------------------------------------
DEFINE TABLE OVERWRITE collaborates_with TYPE RELATION IN student OUT student ENFORCED SCHEMAFULL;

DEFINE FIELD OVERWRITE in  ON collaborates_with TYPE record<student>;
DEFINE FIELD OVERWRITE out ON collaborates_with TYPE record<student>
    ASSERT $value != in AND <string>$value > <string>in;
DEFINE FIELD OVERWRITE project_title ON collaborates_with TYPE string
    ASSERT string::len(string::trim($value)) >= 2 AND string::len($value) <= 80;
DEFINE FIELD OVERWRITE type   ON collaborates_with TYPE string DEFAULT 'project'
    ASSERT $value IN ['project', 'research', 'hackathon', 'study_group'];
DEFINE FIELD OVERWRITE status ON collaborates_with TYPE string DEFAULT 'active'
    ASSERT $value IN ['active', 'completed', 'ended'];
DEFINE FIELD OVERWRITE created_at ON collaborates_with TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE ended_at   ON collaborates_with TYPE option<datetime>;

DEFINE INDEX OVERWRITE collaborates_with_unique ON collaborates_with FIELDS in, out, project_title UNIQUE;

-- ----------------------------------------------------------------------------
-- NODE: activity  (+ EDGE involves: activity -> student)
-- The activity feed is part of the graph, not a separate audit subsystem.
-- ----------------------------------------------------------------------------
DEFINE TABLE OVERWRITE activity SCHEMAFULL;
DEFINE FIELD OVERWRITE kind       ON activity TYPE string;
DEFINE FIELD OVERWRITE message    ON activity TYPE string;
DEFINE FIELD OVERWRITE created_at ON activity TYPE datetime DEFAULT time::now() READONLY;

DEFINE TABLE OVERWRITE involves TYPE RELATION IN activity OUT student ENFORCED SCHEMAFULL;
DEFINE FIELD OVERWRITE in  ON involves TYPE record<activity>;
DEFINE FIELD OVERWRITE out ON involves TYPE record<student>;

-- ----------------------------------------------------------------------------
-- Stored function: write one activity node and link it to the students involved.
-- It runs inside whatever transaction calls it, so the log can never disagree
-- with the change it describes.
-- ----------------------------------------------------------------------------
DEFINE FUNCTION OVERWRITE fn::log_activity($kind: string, $message: string, $who: array<record<student>>) {
    LET $a = CREATE ONLY activity SET kind = $kind, message = $message;
    FOR $s IN $who {
        RELATE ($a.id)->involves->($s);
    };
    RETURN $a.id;
};
