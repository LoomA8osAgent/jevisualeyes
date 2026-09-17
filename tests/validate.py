"""Offline fixture/schema/SQL checks. No network or provider calls."""
from pathlib import Path
import json, sqlite3, copy, re
from jsonschema import Draft202012Validator, FormatChecker
ROOT=Path(__file__).resolve().parents[1]
checks=[]
def check(name, fn):
    fn(); checks.append(name)
def load(path):return json.loads((ROOT/path).read_text())
def validator(name):return Draft202012Validator(load('schemas/'+name+'.schema.json'), format_checker=FormatChecker())
pairs=[('hand-authored-project.json','project'),('edit-request.json','edit'),('jev-request.json','choice-request'),('jev-response.synthetic.json','choice-response'),('decision-receipt.synthetic.json','receipt')]
for schema in sorted((ROOT/'schemas').glob('*.json')):
    check('schema-definition:'+schema.name,lambda s=schema:Draft202012Validator.check_schema(json.loads(s.read_text())))
for name,schema in pairs:
    check('fixture:'+name,lambda n=name,s=schema:validator(s).validate(load('examples/'+n)))
def reject_mutation(name, f):
    x=load('examples/hand-authored-project.json');f(x)
    if not list(validator('project').iter_errors(x)):raise AssertionError('Mutation accepted: '+name)
check('reject:wrong-version',lambda:reject_mutation('version',lambda x:x.update(schemaVersion='future')))
check('reject:negative-duration',lambda:reject_mutation('duration',lambda x:x['tracks'][0]['notes'][0].update(durationTicks=-1)))
check('reject:velocity-zero',lambda:reject_mutation('velocity',lambda x:x['tracks'][0]['notes'][0].update(velocity=0)))
check('reject:unknown-field',lambda:reject_mutation('extra',lambda x:x.update(secret='should not import')))
def invalid_edit_parameters():
    x=load('examples/edit-request.json');x['operation']='setTempo';x['parameters']={'bpm':-20}
    assert list(validator('edit').iter_errors(x)), 'Invalid tempo parameters accepted'
check('reject:operation-specific-edit-parameters',invalid_edit_parameters)
def unsafe_placeholders():
    # Placeholder example.invalid is a schema identifier, not a network endpoint.
    for path in ROOT.rglob('*'):
        if path.is_file() and path.suffix in ('.json','.md','.ts','.mjs','.sql'):
            text=path.read_text()
            if re.search(r'Bearer\s+(sk-[A-Za-z0-9]{10,})',text):raise AssertionError('Possible leaked key')
check('no-embedded-provider-secret-pattern',unsafe_placeholders)
def source_and_doc_links():
    sources=(ROOT/'docs/08_SOURCES_DECISIONS.md').read_text()
    for p in (ROOT/'docs').glob('*.md'):
        for n in re.findall(r'\[S(\d{2})\]',p.read_text()):
            assert ('| S'+n+' |') in sources,(p,n)
    spec=(ROOT/'SPEC.md').read_text()
    for p in sorted((ROOT/'docs').glob('*.md')):assert p.read_text().strip() in spec
check('source-IDs-and-assembled-spec-consistency',source_and_doc_links)
def sqlite_checks():
    conn=sqlite3.connect(':memory:');conn.executescript((ROOT/'reference/storage.sql').read_text())
    conn.execute("INSERT INTO projects VALUES ('p','owner','title',NULL,'t','t')")
    conn.execute("INSERT INTO revisions VALUES ('r','p',NULL,'{}','hash','cmd','t')")
    conn.execute("INSERT INTO jobs VALUES ('j','p','r','jobcmd','composing',1,0,'{}','{}','t')")
    conn.execute("INSERT INTO pending_decisions VALUES ('d','j',0,1,'{}','h','[]','h',NULL)")
    conn.execute("INSERT INTO attempts(decision_id,attempt_index,status,started_at) VALUES ('d',1,'started','t')")
    conn.commit()
    try:conn.execute("INSERT INTO pending_decisions VALUES ('d2','j',0,1,'{}','h','[]','h',NULL)")
    except sqlite3.IntegrityError:conn.rollback()
    else:raise AssertionError('Duplicate decision accepted')
    try:conn.execute("INSERT INTO attempts(decision_id,attempt_index,status,started_at) VALUES ('d',1,'started','t')")
    except sqlite3.IntegrityError:conn.rollback()
    else:raise AssertionError('Duplicate attempt accepted')
    conn.execute('BEGIN')
    conn.execute("UPDATE jobs SET decision_index=1 WHERE id='j'")
    conn.execute("INSERT INTO job_events VALUES ('j',1,'decision.committed','{}','t')")
    conn.rollback()
    assert conn.execute("SELECT decision_index FROM jobs WHERE id='j'").fetchone()[0]==0
    assert conn.execute('SELECT COUNT(*) FROM job_events').fetchone()[0]==0
    conn.close()
check('SQLite-layout-uniqueness-and-transaction-rollback',sqlite_checks)
result={'passed':len(checks),'failed':0,'checks':checks,'networkCalls':0,'scope':'Handoff schemas, synthetic fixtures, document assembly, and SQL sketch only; not application or musical validation.'}
print(json.dumps(result,indent=2))
