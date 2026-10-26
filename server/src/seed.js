// Seed (and safely reset) the demo graph.   npm run seed
// Everything here is fictional.
import { pathToFileURL } from 'node:url';
import { connectDb, applySchema, run, closeDb } from './db.js';

/**
 * 14 students. year 4 = final year (natural mentors), year 1 = newest.
 * Mentorship rule used by the app: mentor.year must be greater than mentee.year.
 */
export const STUDENTS = [
  ['arun',   'Arun Kumar',     'CSE',  2, ['Python', 'Machine Learning', 'SQL'],            ['AI', 'Cybersecurity'],      'Curious second-year who wants to link AI with security.'],
  ['meera',  'Meera Nair',     'CSE',  4, ['Machine Learning', 'Python', 'Research'],       ['AI', 'Data Science'],       'Final-year researcher, enjoys mentoring juniors in ML.'],
  ['rahul',  'Rahul Verma',    'CSE',  1, ['C', 'Python'],                                  ['AI', 'Web Development'],    'First-year, learning the ropes of programming.'],
  ['priya',  'Priya Sharma',   'ECE',  3, ['Embedded Systems', 'IoT', 'C'],                 ['Robotics', 'IoT'],          'Builds sensor networks and tiny robots.'],
  ['karthik','Karthik Raj',    'CSE',  4, ['Cybersecurity', 'Linux', 'Networking'],         ['Cybersecurity', 'CTF'],     'CTF player and security club lead.'],
  ['divya',  'Divya Menon',    'EEE',  3, ['Power Systems', 'MATLAB', 'Python'],            ['Renewable Energy', 'AI'],   'Works on smart-grid forecasting.'],
  ['sanjay', 'Sanjay Iyer',    'ECE',  2, ['VLSI', 'Verilog', 'C'],                         ['Chip Design', 'Robotics'],  'Likes digital design and FPGA boards.'],
  ['ananya', 'Ananya Das',     'CSE',  3, ['React', 'Node.js', 'UI Design'],                ['Web Development', 'Design'],'Full-stack builder and hackathon regular.'],
  ['vikram', 'Vikram Singh',   'IT',   4, ['Cloud', 'DevOps', 'Networking'],                ['Cloud', 'Cybersecurity'],   'Cloud and DevOps enthusiast, interned at a startup.'],
  ['neha',   'Neha Pillai',    'EEE',  1, ['MATLAB', 'Circuits'],                           ['Renewable Energy'],         'First-year exploring power electronics.'],
  ['aditya', 'Aditya Rao',     'ECE',  4, ['Embedded Systems', 'Robotics', 'C++'],          ['Robotics', 'AI'],           'Final-year robotics lead.'],
  ['isha',   'Isha Kapoor',    'CSE',  2, ['Data Analysis', 'Python', 'Statistics'],        ['Data Science', 'AI'],       'Loves turning messy data into stories.'],
  ['rohan',  'Rohan Mehta',    'IT',   3, ['Java', 'Spring', 'SQL'],                        ['Backend', 'Databases'],     'Backend developer, database nerd.'],
  ['sneha',  'Sneha Joshi',    'ECE',  1, ['Python', 'Arduino'],                            ['IoT', 'Robotics'],          'First-year tinkerer with an Arduino collection.'],
];

// friends (undirected)
const FRIENDS = [
  ['arun', 'meera', 'close'], ['arun', 'isha', 'friend'], ['arun', 'rahul', 'friend'],
  ['meera', 'karthik', 'friend'], ['meera', 'isha', 'close'], ['rahul', 'ananya', 'friend'],
  ['priya', 'sanjay', 'close'], ['priya', 'aditya', 'friend'], ['priya', 'sneha', 'friend'],
  ['karthik', 'vikram', 'close'], ['vikram', 'rohan', 'friend'], ['ananya', 'rohan', 'friend'],
  ['divya', 'neha', 'friend'], ['divya', 'isha', 'friend'], ['aditya', 'sanjay', 'friend'],
  ['karthik', 'arun', 'friend'], ['ananya', 'meera', 'friend'], ['sneha', 'rahul', 'friend'],
];

// active mentorships: [mentor, mentee, expertise]
const MENTORS = [
  ['meera',  'rahul',  'Machine Learning'],
  ['karthik', 'arun',  'Cybersecurity'],
  ['aditya', 'sanjay', 'Embedded Systems'],
  ['vikram', 'rohan',  'Cloud'],
  ['aditya', 'sneha',  'Robotics'],
];

// pending requests: [mentee, mentor, expertise, message]
const REQUESTS = [
  ['arun',  'meera',   'Machine Learning', 'Hi Meera, could you guide me on applying ML to security data?'],
  ['isha',  'meera',   'Research',         'I would love advice on writing my first research paper.'],
  ['neha',  'vikram',  'Cloud',            'Interested in cloud basics for energy dashboards.'],
  ['priya', 'aditya',  'Robotics',         'Looking for help with my line-follower project.'],
];

// collaborations: [a, b, title, type]
const COLLABS = [
  ['rahul',  'priya',  'Smart Plant Monitor',        'project'],
  ['ananya', 'rohan',  'Hackathon Event Portal',     'hackathon'],
  ['meera',  'divya',  'Solar Forecast with ML',     'research'],
  ['arun',   'karthik','Campus CTF Platform',        'project'],
  ['sanjay', 'aditya', 'FPGA Line Follower',         'project'],
  ['isha',   'ananya', 'Data Dashboard for Clubs',   'project'],
  ['divya',  'priya',  'IoT Smart Meter',            'research'],
];

const sid = (k) => ({ table: 'student', key: k });
const ordered = (a, b) => (`student:${a}` < `student:${b}` ? [a, b] : [b, a]);

/** Wipe the graph and rebuild the demo data. Safe to run repeatedly. */
export async function seedDemoData() {
  await applySchema();
  // Remove edges first, then nodes. All tables, all rows.
  await run(`
    DELETE involves; DELETE activity;
    DELETE friends_with; DELETE mentorship_request; DELETE mentors; DELETE collaborates_with;
    DELETE student;`);

  const statements = [];
  const vars = {};
  const mk = (k) => `type::record('student', $s_${k})`;

  for (const [key, name, dept, year, skills, interests, bio] of STUDENTS) {
    vars[`s_${key}`] = key;
    vars[`n_${key}`] = name;
    vars[`sk_${key}`] = skills;
    vars[`in_${key}`] = interests;
    vars[`b_${key}`] = bio;
    statements.push(
      `CREATE type::record('student', $s_${key}) SET name = $n_${key}, email = '${key}@campus.edu', department = '${dept}', year = ${year}, skills = $sk_${key}, interests = $in_${key}, bio = $b_${key};`,
    );
  }
  for (const [a, b, level] of FRIENDS) {
    const [x, y] = ordered(a, b);
    statements.push(`RELATE (${mk(x)})->friends_with->(${mk(y)}) SET level = '${level}';`);
  }
  MENTORS.forEach(([mentor, mentee, exp], i) => {
    vars[`me_${i}`] = exp;
    statements.push(`RELATE (${mk(mentor)})->mentors->(${mk(mentee)}) SET expertise = $me_${i};`);
  });
  REQUESTS.forEach(([mentee, mentor, exp, msg], i) => {
    vars[`re_${i}`] = exp;
    vars[`rm_${i}`] = msg;
    statements.push(`RELATE (${mk(mentee)})->mentorship_request->(${mk(mentor)}) SET expertise = $re_${i}, message = $rm_${i};`);
  });
  COLLABS.forEach(([a, b, title, type], i) => {
    const [x, y] = ordered(a, b);
    vars[`ct_${i}`] = title;
    statements.push(`RELATE (${mk(x)})->collaborates_with->(${mk(y)}) SET project_title = $ct_${i}, type = '${type}';`);
  });
  // a few starting activity nodes, linked into the graph
  statements.push(
    `fn::log_activity('mentorship_accepted', 'Meera Nair is now mentoring Rahul Verma in Machine Learning', [type::record('student','meera'), type::record('student','rahul')]);`,
    `fn::log_activity('collaboration_added', 'Rahul Verma and Priya Sharma started "Smart Plant Monitor"', [type::record('student','rahul'), type::record('student','priya')]);`,
    `fn::log_activity('mentorship_requested', 'Arun Kumar asked Meera Nair for Machine Learning mentorship', [type::record('student','arun'), type::record('student','meera')]);`,
  );

  await run(statements.join('\n'), vars);
  const [counts] = await run(`RETURN {
    students: array::len((SELECT id FROM student)),
    friendships: array::len((SELECT id FROM friends_with)),
    mentorships: array::len((SELECT id FROM mentors)),
    pending: array::len((SELECT id FROM mentorship_request WHERE status = 'pending')),
    collaborations: array::len((SELECT id FROM collaborates_with)) };`);
  return counts;
}

// CLI: node src/seed.js
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await connectDb();
    const counts = await seedDemoData();
    console.log('Demo graph seeded:', counts);
  } catch (e) {
    console.error('Seeding failed:', e.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

export { sid };
