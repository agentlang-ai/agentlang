import { assert, describe, expect, test } from 'vitest';
import {
  workflow,
  triggerWorkflow,
  create,
  query,
  queryUpdate,
  ref,
  str,
  num,
  bool,
  id,
  arr,
  map,
  expr,
  fnCall,
  asyncFnCall,
  ifThen,
  forEach,
  del,
  purge,
  ret,
  throwError,
} from '../../src/codegen/workflow.js';

describe('Workflow codegen API', () => {
  // ── Value constructors ──

  test('ref produces Record.member format', () => {
    expect(ref('CreateUser', 'name').toString()).toBe('CreateUser.name');
  });

  test('str produces quoted string', () => {
    expect(str('hello').toString()).toBe('"hello"');
  });

  test('num produces number', () => {
    expect(num(42).toString()).toBe('42');
  });

  test('bool produces boolean', () => {
    expect(bool(true).toString()).toBe('true');
    expect(bool(false).toString()).toBe('false');
  });

  test('id produces bare identifier', () => {
    expect(id('post').toString()).toBe('post');
  });

  test('arr produces array literal', () => {
    expect(arr([str('a'), num(1)]).toString()).toBe('["a", 1]');
  });

  test('map produces map literal', () => {
    expect(map({ key: str('val') }).toString()).toBe('{"key": "val"}');
  });

  test('expr produces raw expression', () => {
    expect(expr('a.x * 0.5').toString()).toBe('a.x * 0.5');
  });

  test('fnCall produces function call', () => {
    expect(fnCall('uuid', []).toString()).toBe('uuid()');
    expect(fnCall('concat', [str('a'), str('b')]).toString()).toBe('concat("a", "b")');
  });

  test('asyncFnCall produces await function call', () => {
    expect(asyncFnCall('fetch', [str('url')]).toString()).toBe('await fetch("url")');
  });

  // ── Simple create workflow (Blog CreateUser example) ──

  test('simple create workflow', () => {
    const code = workflow('CreateUser', [
      create('User', { name: ref('CreateUser', 'name') }, {
        relationships: {
          UserProfile: create('Profile', { email: ref('CreateUser', 'email') }),
          UserPost: create('Post', { title: str('hello, world') }),
        },
      }),
    ]);
    expect(code).toContain('workflow CreateUser {');
    expect(code).toContain('{User {name CreateUser.name}');
    expect(code).toContain('UserProfile {Profile {email CreateUser.email}}');
    expect(code).toContain('UserPost {Post {title "hello, world"}}');
  });

  // ── Query workflow ──

  test('query with no attributes', () => {
    const code = workflow('FindAll', [
      query('User'),
    ]);
    expect(code).toBe(
      `workflow FindAll {\n` +
      `    {User? {}}\n` +
      `}`
    );
  });

  test('query with attributes', () => {
    const code = workflow('FindUsersByName', [
      query('User', { name: { value: ref('FindUsersByName', 'name') } }),
    ]);
    expect(code).toBe(
      `workflow FindUsersByName {\n` +
      `    {User {name? FindUsersByName.name}}\n` +
      `}`
    );
  });

  // ── Query with relationships and @into ──

  test('query with relationships and @into', () => {
    const code = workflow('FindUserProfileAndPosts', [
      query('User', { id: { value: ref('FindUserProfileAndPosts', 'userId') } }, {
        relationships: {
          UserProfile: query('Profile'),
          UserPost: query('Post'),
        },
        into: {
          userName: 'Blog.Core/User.name',
          userEmail: 'Blog.Core/Profile.email',
          postTitle: 'Blog.Core/Post.title',
        },
      }),
    ]);
    expect(code).toContain('{User {id? FindUserProfileAndPosts.userId}');
    expect(code).toContain('UserProfile {Profile? {}}');
    expect(code).toContain('UserPost {Post? {}}');
    expect(code).toContain('@into {userName Blog.Core/User.name');
    expect(code).toContain('userEmail Blog.Core/Profile.email');
    expect(code).toContain('postTitle Blog.Core/Post.title}');
  });

  // ── Trigger workflow ──

  test('trigger workflow (@after create)', () => {
    const code = triggerWorkflow('after', 'create', 'slack/Message', [
      ifThen('slack/Message.userMessage', [
        query('ProcessedMessage', { ts: { value: ref('slack/Message', 'ts') } }, {
          catch: {
            not_found: create('invokeIssueManager', {
              text: ref('slack/Message', 'text'),
              ts: ref('slack/Message', 'ts'),
            }),
          },
        }),
      ]),
    ]);
    expect(code).toContain('workflow @after create:slack/Message');
    expect(code).toContain('if(slack/Message.userMessage)');
    expect(code).toContain('{ProcessedMessage {ts? slack/Message.ts}}');
    expect(code).toContain('not_found {invokeIssueManager {text slack/Message.text, ts slack/Message.ts}}');
  });

  // ── if/else conditionals ──

  test('if/else conditional', () => {
    const code = workflow('validateRequest', [
      ifThen('not(validateRequest.data.requestedBy)', [
        create('ValidationResult', { status: str('error'), reason: str('requestedBy is required') }),
      ], [
        create('ValidationResult', { status: str('ok') }),
      ]),
    ]);
    expect(code).toContain('if(not(validateRequest.data.requestedBy))');
    expect(code).toContain('{ValidationResult {status "error", reason "requestedBy is required"}}');
    expect(code).toContain('else {');
    expect(code).toContain('{ValidationResult {status "ok"}}');
  });

  test('chained else-if', () => {
    const code = workflow('validate', [
      ifThen('not(x.a)', [
        create('R', { status: str('err1') }),
      ], [
        ifThen('not(x.b)', [
          create('R', { status: str('err2') }),
        ], [
          create('R', { status: str('ok') }),
        ]),
      ]),
    ]);
    expect(code).toContain('if(not(x.a))');
    expect(code).toContain('else if(not(x.b))');
    expect(code).toContain('else {');
  });

  // ── for loops ──

  test('for loop', () => {
    const code = workflow('processItems', [
      forEach('item', query('Item'), [
        create('ProcessedItem', { name: ref('item', 'name') }),
      ]),
    ]);
    expect(code).toContain('for item in {Item? {}}');
    expect(code).toContain('{ProcessedItem {name item.name}}');
  });

  // ── delete patterns ──

  test('delete pattern', () => {
    const code = workflow('cleanup', [
      del(query('Timer', { id: { value: ref('cleanup', 'timerId') } })),
    ]);
    expect(code).toContain('delete {Timer {id? cleanup.timerId}}');
  });

  // ── purge pattern ──

  test('purge pattern', () => {
    const code = workflow('purgeAll', [
      purge(query('OldData')),
    ]);
    expect(code).toContain('purge {OldData? {}}');
  });

  // ── @catch error handlers ──

  test('@catch handler', () => {
    const stmt = query('Entity', { id: { value: ref('E', 'id') } }, {
      catch: {
        not_found: create('Fallback', { msg: str('not found') }),
      },
    });
    const s = stmt.toString();
    expect(s).toContain('{Entity {id? E.id}}');
    expect(s).toContain('@catch');
    expect(s).toContain('not_found {Fallback {msg "not found"}}');
  });

  // ── @then chaining ──

  test('@then chaining', () => {
    const code = workflow('EF', [
      create('E', { id: ref('EF', 'id'), x: ref('EF', 'x') }, {
        alias: 'e',
        then: [
          create('F', { id: expr('e.id * 10') }),
        ],
      }),
    ]);
    expect(code).toContain('{E {id EF.id, x EF.x}}');
    expect(code).toContain('@as e');
    expect(code).toContain('@then {');
    expect(code).toContain('{F {id e.id * 10}}');
  });

  // ── @as aliasing ──

  test('@as single alias', () => {
    const stmt = query('Post', { id: { value: ref('X', 'postId') } }, {
      alias: 'post',
    });
    expect(stmt.toString()).toContain('@as post');
  });

  test('@as array alias', () => {
    const stmt = query('Post', { id: { value: ref('X', 'postId') } }, {
      alias: ['post', 'cat'],
    });
    expect(stmt.toString()).toContain('@as [post,cat]');
  });

  // ── Join queries ──

  test('query with join and @into', () => {
    const code = workflow('customerOrders', [
      query('Order', {}, {
        joins: [{
          type: '@join',
          entity: 'Customer',
          on: { lhs: 'customerId', rhs: 'Order.customerId' },
        }],
        into: {
          OrderID: 'Order.orderId',
          CustomerName: 'Customer.name',
          OrderDate: 'Order.orderDate',
        },
      }),
    ], { isPublic: true });
    expect(code).toContain('@public workflow customerOrders');
    expect(code).toContain('{Order? {}');
    expect(code).toContain('@join Customer {customerId? Order.customerId}');
    expect(code).toContain('@into {OrderID Order.orderId');
    expect(code).toContain('CustomerName Customer.name');
  });

  test('left join', () => {
    const stmt = query('Customer', {}, {
      joins: [{
        type: '@left_join',
        entity: 'Order',
        on: { lhs: 'customerId', rhs: 'Customer.customerId' },
      }],
      into: {
        OrderID: 'Order.orderId',
        CustomerName: 'Customer.name',
      },
    });
    expect(stmt.toString()).toContain('@left_join Order {customerId? Customer.customerId}');
  });

  // ── @upsert ──

  test('@upsert on create', () => {
    const stmt = create('User', { email: str('abc@cc.com'), firstName: str('A') }, {
      upsert: true,
    });
    expect(stmt.toString()).toContain('{User {email "abc@cc.com", firstName "A"}, @upsert}');
  });

  // ── @distinct ──

  test('@distinct on query', () => {
    const stmt = query('User', { status: { value: str('active') } }, {
      distinct: true,
    });
    expect(stmt.toString()).toContain('@distinct');
  });

  // ── @public and @withRole directives ──

  test('@public workflow', () => {
    const code = workflow('help', [
      create('Response', { text: str('help text') }),
    ], { isPublic: true });
    expect(code).toContain('@public workflow help');
  });

  test('@withRole directive', () => {
    const code = workflow('adminAction', [
      create('AuditLog', { action: str('delete') }),
    ], { withRole: 'admin' });
    expect(code).toContain('workflow adminAction @withRole(admin)');
  });

  test('@public with @withRole', () => {
    const code = workflow('secureAction', [
      create('Result', {}),
    ], { isPublic: true, withRole: 'manager' });
    expect(code).toContain('@public workflow secureAction @withRole(manager)');
  });

  // ── Query-update patterns ──

  test('query-update pattern', () => {
    const code = workflow('UpdateUserName', [
      queryUpdate('User',
        { id: { value: ref('UpdateUserName', 'userId') } },
        { name: ref('UpdateUserName', 'newName') },
      ),
    ]);
    expect(code).toContain('{User {id? UpdateUserName.userId, name UpdateUserName.newName}}');
  });

  // ── return and throw ──

  test('return pattern', () => {
    const code = workflow('getResult', [
      ret(query('Result', { id: { value: ref('getResult', 'id') } })),
    ]);
    expect(code).toContain('return {Result {id? getResult.id}}');
  });

  test('throw with string expression', () => {
    const code = workflow('failWorkflow', [
      throwError('"something went wrong"'),
    ]);
    expect(code).toContain('throw ("something went wrong")');
  });

  test('throw with value expression', () => {
    const code = workflow('failWorkflow', [
      throwError(str('bad request')),
    ]);
    expect(code).toContain('throw ("bad request")');
  });

  // ── Multiple statements with semicolons ──

  test('multiple statements separated by semicolons', () => {
    const code = workflow('multiStep', [
      create('A', { x: num(1) }),
      create('B', { y: num(2) }),
      create('C', { z: num(3) }),
    ]);
    expect(code).toContain('{A {x 1}};\n');
    expect(code).toContain('{B {y 2}};\n');
    expect(code).toContain('{C {z 3}}');
    // Last statement should not have trailing semicolon
    assert(!code.endsWith(';\n}'));
  });

  // ── Relationships with arrays ──

  test('create with relationship array', () => {
    const code = workflow('CreateUserWithPosts', [
      create('User', { name: ref('CreateUserWithPosts', 'name') }, {
        relationships: {
          UserPost: [
            create('Post', { title: ref('CreateUserWithPosts', 'post1') }),
            create('Post', { title: ref('CreateUserWithPosts', 'post2') }),
          ],
        },
      }),
    ]);
    expect(code).toContain('UserPost [');
    expect(code).toContain('{Post {title CreateUserWithPosts.post1}}');
    expect(code).toContain('{Post {title CreateUserWithPosts.post2}}');
  });

  // ── @where clause ──

  test('query with @where', () => {
    const stmt = query('Order', {}, {
      where: [
        { lhs: 'amount', op: '>', rhs: num(100) },
        { lhs: 'status', rhs: str('pending') },
      ],
    });
    const s = stmt.toString();
    expect(s).toContain('@where {amount?> 100, status? "pending"}');
  });

  // ── @groupBy clause ──

  test('query with @groupBy', () => {
    const stmt = query('Order', {}, {
      groupBy: ['customerId', 'status'],
    });
    expect(stmt.toString()).toContain('@groupBy(customerId, status)');
  });

  // ── @orderBy clause ──

  test('query with @orderBy', () => {
    const stmt = query('Order', {}, {
      orderBy: { columns: ['createdAt'], order: 'desc' },
    });
    expect(stmt.toString()).toContain('@orderBy(createdAt) @desc');
  });

  test('query with @orderBy no explicit order', () => {
    const stmt = query('Order', {}, {
      orderBy: { columns: ['name'] },
    });
    expect(stmt.toString()).toContain('@orderBy(name)');
    expect(stmt.toString()).not.toContain('@asc');
    expect(stmt.toString()).not.toContain('@desc');
  });

  // ── Complex end-to-end examples ──

  test('full trigger workflow matching jira example', () => {
    const code = triggerWorkflow('after', 'create', 'slack/Message', [
      ifThen('slack/Message.userMessage', [
        query('ProcessedMessage', { ts: { value: ref('slack/Message', 'ts') } }, {
          catch: {
            not_found: create('invokeIssueManager', {
              text: ref('slack/Message', 'text'),
              ts: ref('slack/Message', 'ts'),
            }),
          },
        }),
      ]),
    ]);
    // Verify the overall structure
    expect(code).toContain('workflow @after create:slack/Message');
    expect(code).toContain('if(slack/Message.userMessage)');
    expect(code).toContain('{ProcessedMessage {ts? slack/Message.ts}}');
  });

  test('workflow with @then and @as', () => {
    const code = workflow('EF', [
      create('E', { id: ref('EF', 'id'), x: ref('EF', 'x') }, {
        alias: 'e',
        then: [
          create('F', { id: expr('e.id * 10') }),
        ],
      }),
      id('e'),
    ]);
    expect(code).toContain('workflow EF');
    expect(code).toContain('{E {id EF.id, x EF.x}}');
    expect(code).toContain('@as e');
    expect(code).toContain('@then');
    expect(code).toContain('{F {id e.id * 10}}');
    // Second statement
    expect(code).toContain('e');
  });

  // ── Expression as attribute value ──

  test('expression as attribute value', () => {
    const stmt = create('Message', {
      text: expr('"**" + notifyUser.summary + "**\\n" + notifyUser.description'),
    });
    expect(stmt.toString()).toContain(
      'text "**" + notifyUser.summary + "**\\n" + notifyUser.description'
    );
  });

  // ── Function call as attribute value ──

  test('function call as value', () => {
    const stmt = create('Entity', {
      id: fnCall('uuid', []),
      score: fnCall('max', [num(0), ref('E', 'val')]),
    });
    expect(stmt.toString()).toContain('id uuid()');
    expect(stmt.toString()).toContain('score max(0, E.val)');
  });

  // ── Boolean literal in create ──

  test('boolean literal in create', () => {
    const stmt = create('Message', {
      userMessage: bool(false),
    });
    expect(stmt.toString()).toContain('userMessage false');
  });
});

// ─────────────────────────────────────────────────────────────────
// Student Management App — complex workflow scenarios
// ─────────────────────────────────────────────────────────────────
describe('Student management app workflows', () => {

  // 1. Enroll a student in a course
  //    Query student + course with error handling, create enrollment,
  //    then chain an initial Grade record via @then
  test('EnrollStudent — query with @catch + create with @then', () => {
    const code = workflow('EnrollStudent', [
      query('Student', { id: { value: ref('EnrollStudent', 'studentId') } }, {
        alias: ['student'],
        catch: {
          not_found: throwError(str('Student not found')),
        },
      }),
      query('Course', { id: { value: ref('EnrollStudent', 'courseId') } }, {
        alias: ['course'],
        catch: {
          not_found: throwError(str('Course not found')),
        },
      }),
      create('StudentEnrollment', {
        Student: id('student'),
        Course: id('course'),
        enrolledAt: fnCall('now', []),
      }, {
        alias: 'enrollment',
        then: [
          create('Grade', {
            studentId: ref('student', 'id'),
            courseId: ref('course', 'id'),
            score: num(0),
            status: str('in-progress'),
          }),
        ],
      }),
    ]);
    expect(code).toContain('workflow EnrollStudent');
    expect(code).toContain('{Student {id? EnrollStudent.studentId}}');
    expect(code).toContain('@as [student]');
    expect(code).toContain('@catch {not_found throw ("Student not found")');
    expect(code).toContain('{Course {id? EnrollStudent.courseId}}');
    expect(code).toContain('@catch {not_found throw ("Course not found")');
    expect(code).toContain('{StudentEnrollment {Student student, Course course, enrolledAt now()}}');
    expect(code).toContain('@as enrollment');
    expect(code).toContain('@then {');
    expect(code).toContain('{Grade {studentId student.id, courseId course.id, score 0, status "in-progress"}}');
  });

  // 2. Record a grade — queryUpdate + conditional honors flag
  test('RecordGrade — queryUpdate + if conditional', () => {
    const code = workflow('RecordGrade', [
      queryUpdate('Grade',
        {
          studentId: { value: ref('RecordGrade', 'studentId') },
          courseId: { value: ref('RecordGrade', 'courseId') },
        },
        {
          score: ref('RecordGrade', 'score'),
          gradedAt: fnCall('now', []),
        },
        { alias: 'updatedGrade' },
      ),
      ifThen('RecordGrade.score >= 90', [
        queryUpdate('Grade',
          {
            studentId: { value: ref('RecordGrade', 'studentId') },
            courseId: { value: ref('RecordGrade', 'courseId') },
          },
          { honors: bool(true) },
        ),
      ]),
    ], { isPublic: true });
    expect(code).toContain('@public workflow RecordGrade');
    expect(code).toContain('studentId? RecordGrade.studentId');
    expect(code).toContain('courseId? RecordGrade.courseId');
    expect(code).toContain('score RecordGrade.score');
    expect(code).toContain('gradedAt now()');
    expect(code).toContain('@as updatedGrade');
    expect(code).toContain('if(RecordGrade.score >= 90)');
    expect(code).toContain('honors true');
  });

  // 3. Generate a report card — relationships + @into + multi-step
  test('GenerateReportCard — relationships, @into, multi-step create', () => {
    const code = workflow('GenerateReportCard', [
      query('Student', { id: { value: ref('GenerateReportCard', 'studentId') } }, {
        relationships: {
          StudentGrade: query('Grade'),
        },
        into: {
          studentName: 'Student.name',
          courseName: 'Course.name',
          score: 'Grade.score',
        },
        alias: ['studentData'],
      }),
      create('ReportCard', {
        studentId: ref('GenerateReportCard', 'studentId'),
        generatedAt: fnCall('now', []),
        semester: ref('GenerateReportCard', 'semester'),
        year: ref('GenerateReportCard', 'year'),
      }, {
        alias: 'reportCard',
      }),
      create('StudentReportCard', {
        Student: id('studentData'),
        ReportCard: id('reportCard'),
      }),
    ], { isPublic: true });
    expect(code).toContain('@public workflow GenerateReportCard');
    expect(code).toContain('{Student {id? GenerateReportCard.studentId}');
    expect(code).toContain('StudentGrade {Grade? {}}');
    expect(code).toContain('@into {studentName Student.name');
    expect(code).toContain('score Grade.score}');
    expect(code).toContain('@as [studentData]');
    expect(code).toContain('{ReportCard {studentId GenerateReportCard.studentId');
    expect(code).toContain('@as reportCard');
    expect(code).toContain('{StudentReportCard {Student studentData, ReportCard reportCard}}');
  });

  // 4. Transfer student between courses — query alias, delete, create
  test('TransferStudent — query alias, delete, create with alias ref', () => {
    const code = workflow('TransferStudent', [
      query('Grade', {
        studentId: { value: ref('TransferStudent', 'studentId') },
        courseId: { value: ref('TransferStudent', 'fromCourseId') },
      }, {
        alias: ['oldGrade'],
      }),
      del(query('StudentEnrollment', {
        studentId: { value: ref('TransferStudent', 'studentId') },
        courseId: { value: ref('TransferStudent', 'fromCourseId') },
      })),
      create('StudentEnrollment', {
        studentId: ref('TransferStudent', 'studentId'),
        courseId: ref('TransferStudent', 'toCourseId'),
        enrolledAt: fnCall('now', []),
      }),
      create('Grade', {
        studentId: ref('TransferStudent', 'studentId'),
        courseId: ref('TransferStudent', 'toCourseId'),
        score: ref('oldGrade', 'score'),
        status: str('transferred'),
      }),
    ], { isPublic: true });
    expect(code).toContain('@public workflow TransferStudent');
    expect(code).toContain('{Grade {studentId? TransferStudent.studentId, courseId? TransferStudent.fromCourseId}}');
    expect(code).toContain('@as [oldGrade]');
    expect(code).toContain('delete {StudentEnrollment {studentId? TransferStudent.studentId');
    expect(code).toContain('{StudentEnrollment {studentId TransferStudent.studentId, courseId TransferStudent.toCourseId');
    expect(code).toContain('score oldGrade.score');
    expect(code).toContain('status "transferred"');
  });

  // 5. Record attendance — forEach over enrolled students
  test('RecordAttendance — forEach loop', () => {
    const code = workflow('RecordAttendance', [
      forEach(
        'enrollment',
        query('StudentEnrollment', {
          courseId: { value: ref('RecordAttendance', 'courseId') },
        }),
        [
          create('Attendance', {
            studentId: ref('enrollment', 'studentId'),
            courseId: ref('RecordAttendance', 'courseId'),
            date: ref('RecordAttendance', 'date'),
            present: ref('RecordAttendance', 'present'),
          }),
        ],
      ),
    ], { isPublic: true });
    expect(code).toContain('@public workflow RecordAttendance');
    expect(code).toContain('for enrollment in {StudentEnrollment {courseId? RecordAttendance.courseId}}');
    expect(code).toContain('{Attendance {studentId enrollment.studentId');
    expect(code).toContain('date RecordAttendance.date');
  });

  // 6. Assign teacher — @catch as create-if-missing + @withRole
  test('AssignTeacher — @catch not_found create + @withRole', () => {
    const code = workflow('AssignTeacher', [
      query('TeacherCourse', {
        teacherId: { value: ref('AssignTeacher', 'teacherId') },
      }, {
        alias: ['existingAssignments'],
        catch: {
          not_found: create('TeacherCourse', {
            teacherId: ref('AssignTeacher', 'teacherId'),
            courseId: ref('AssignTeacher', 'courseId'),
          }),
        },
      }),
      create('CourseClassroom', {
        courseId: ref('AssignTeacher', 'courseId'),
        classroomId: ref('AssignTeacher', 'classroomId'),
      }),
    ], { isPublic: true, withRole: 'admin' });
    expect(code).toContain('@public workflow AssignTeacher @withRole(admin)');
    expect(code).toContain('{TeacherCourse {teacherId? AssignTeacher.teacherId}}');
    expect(code).toContain('@as [existingAssignments]');
    expect(code).toContain('@catch {not_found {TeacherCourse {teacherId AssignTeacher.teacherId, courseId AssignTeacher.courseId}}');
    expect(code).toContain('{CourseClassroom {courseId AssignTeacher.courseId, classroomId AssignTeacher.classroomId}}');
  });

  // 7. Student dashboard — deep nested relationships + @into
  test('StudentDashboard — multi-relationship query with @into', () => {
    const code = workflow('StudentDashboard', [
      query('Student', { id: { value: ref('StudentDashboard', 'studentId') } }, {
        relationships: {
          StudentEnrollment: query('Course'),
          StudentGrade: query('Grade'),
          StudentAttendance: query('Attendance'),
        },
        into: {
          studentName: 'Student.name',
          courseName: 'Course.name',
          grade: 'Grade.score',
          attendanceDate: 'Attendance.date',
          present: 'Attendance.present',
        },
      }),
    ], { isPublic: true });
    expect(code).toContain('@public workflow StudentDashboard');
    expect(code).toContain('{Student {id? StudentDashboard.studentId}');
    expect(code).toContain('StudentEnrollment {Course? {}}');
    expect(code).toContain('StudentGrade {Grade? {}}');
    expect(code).toContain('StudentAttendance {Attendance? {}}');
    expect(code).toContain('@into {studentName Student.name');
    expect(code).toContain('grade Grade.score');
    expect(code).toContain('present Attendance.present}');
  });

  // 8. Course grade summary — @join + @groupBy + @orderBy
  test('CourseGradeSummary — join, groupBy, orderBy', () => {
    const code = workflow('CourseGradeSummary', [
      query('Grade', {}, {
        joins: [{
          type: '@join',
          entity: 'Course',
          on: { lhs: 'courseId', rhs: 'Grade.courseId' },
        }],
        into: {
          courseName: 'Course.name',
          avgScore: 'Grade.score',
        },
        groupBy: ['Course.name'],
        orderBy: { columns: ['Grade.score'], order: 'desc' },
      }),
    ], { isPublic: true });
    expect(code).toContain('@public workflow CourseGradeSummary');
    expect(code).toContain('{Grade? {}');
    expect(code).toContain('@join Course {courseId? Grade.courseId}');
    expect(code).toContain('@groupBy(Course.name)');
    expect(code).toContain('@orderBy(Grade.score) @desc');
    expect(code).toContain('@into {courseName Course.name');
    expect(code).toContain('avgScore Grade.score}');
  });

  // 9. Trigger: auto-notify when a grade is created
  test('NotifyOnGrade — @after create trigger', () => {
    const code = triggerWorkflow('after', 'create', 'Grade', [
      query('Student', { id: { value: ref('Grade', 'studentId') } }, {
        alias: ['student'],
      }),
      query('Course', { id: { value: ref('Grade', 'courseId') } }, {
        alias: ['course'],
      }),
      create('Notification', {
        recipientId: ref('student', 'id'),
        message: expr('"Grade recorded: " + course.name + " - Score: " + Grade.score'),
        type: str('grade'),
        read: bool(false),
        createdAt: fnCall('now', []),
      }),
    ]);
    expect(code).toContain('workflow @after create:Grade');
    expect(code).toContain('{Student {id? Grade.studentId}}');
    expect(code).toContain('@as [student]');
    expect(code).toContain('{Course {id? Grade.courseId}}');
    expect(code).toContain('@as [course]');
    expect(code).toContain('{Notification {recipientId student.id');
    expect(code).toContain('message "Grade recorded: " + course.name + " - Score: " + Grade.score');
    expect(code).toContain('type "grade"');
    expect(code).toContain('read false');
    expect(code).toContain('createdAt now()');
  });

  // 10. Trigger: validate enrollment before create
  test('ValidateEnrollment — @before create trigger with throw', () => {
    const code = triggerWorkflow('before', 'create', 'StudentEnrollment', [
      query('StudentEnrollment', {
        studentId: { value: ref('StudentEnrollment', 'studentId') },
        courseId: { value: ref('StudentEnrollment', 'courseId') },
      }, {
        catch: {
          not_found: create('agentlang/ValidationResult', {
            status: str('ok'),
          }),
        },
      }),
      throwError(str('Student is already enrolled in this course')),
    ]);
    expect(code).toContain('workflow @before create:StudentEnrollment');
    expect(code).toContain('{StudentEnrollment {studentId? StudentEnrollment.studentId, courseId? StudentEnrollment.courseId}}');
    expect(code).toContain('@catch {not_found {agentlang/ValidationResult {status "ok"}}');
    expect(code).toContain('throw ("Student is already enrolled in this course")');
  });

  // 11. Unenroll student — cascading deletes
  test('UnenrollStudent — cascading delete', () => {
    const code = workflow('UnenrollStudent', [
      del(query('Grade', {
        studentId: { value: ref('UnenrollStudent', 'studentId') },
        courseId: { value: ref('UnenrollStudent', 'courseId') },
      })),
      del(query('Attendance', {
        studentId: { value: ref('UnenrollStudent', 'studentId') },
        courseId: { value: ref('UnenrollStudent', 'courseId') },
      })),
      del(query('StudentEnrollment', {
        studentId: { value: ref('UnenrollStudent', 'studentId') },
        courseId: { value: ref('UnenrollStudent', 'courseId') },
      })),
    ], { isPublic: true });
    expect(code).toContain('@public workflow UnenrollStudent');
    expect(code).toContain('delete {Grade {studentId? UnenrollStudent.studentId, courseId? UnenrollStudent.courseId}}');
    expect(code).toContain('delete {Attendance {studentId? UnenrollStudent.studentId, courseId? UnenrollStudent.courseId}}');
    expect(code).toContain('delete {StudentEnrollment {studentId? UnenrollStudent.studentId, courseId? UnenrollStudent.courseId}}');
  });

  // 12. Validate grade input — chained if/else-if/else
  test('ValidateGradeInput — chained if/else-if validation', () => {
    const code = workflow('ValidateGradeInput', [
      ifThen('not(ValidateGradeInput.data.studentId)', [
        create('agentlang/ValidationResult', {
          status: str('error'),
          reason: str('studentId is required'),
        }),
      ], [
        ifThen('not(ValidateGradeInput.data.courseId)', [
          create('agentlang/ValidationResult', {
            status: str('error'),
            reason: str('courseId is required'),
          }),
        ], [
          ifThen('ValidateGradeInput.data.score < 0 or ValidateGradeInput.data.score > 100', [
            create('agentlang/ValidationResult', {
              status: str('error'),
              reason: str('Score must be between 0 and 100'),
            }),
          ], [
            create('agentlang/ValidationResult', {
              status: str('ok'),
            }),
          ]),
        ]),
      ]),
    ]);
    expect(code).toContain('workflow ValidateGradeInput');
    expect(code).toContain('if(not(ValidateGradeInput.data.studentId))');
    expect(code).toContain('{agentlang/ValidationResult {status "error", reason "studentId is required"}}');
    expect(code).toContain('else if(not(ValidateGradeInput.data.courseId))');
    expect(code).toContain('reason "courseId is required"');
    expect(code).toContain('else if(ValidateGradeInput.data.score < 0 or ValidateGradeInput.data.score > 100)');
    expect(code).toContain('reason "Score must be between 0 and 100"');
    expect(code).toContain('{agentlang/ValidationResult {status "ok"}}');
  });

  // 13. Seed sample data — multi-create with aliases + relationship wiring
  test('SeedSampleData — multi-create with alias references', () => {
    const code = workflow('SeedSampleData', [
      create('Teacher', { name: str('Dr. Smith'), department: str('Mathematics') }, {
        alias: 'mathTeacher',
      }),
      create('Teacher', { name: str('Prof. Jones'), department: str('Science') }, {
        alias: 'sciTeacher',
      }),
      create('Course', { name: str('Algebra 101'), credits: num(3) }, {
        alias: 'algebra',
      }),
      create('Course', { name: str('Physics 201'), credits: num(4) }, {
        alias: 'physics',
      }),
      create('Classroom', { building: str('Science Hall'), roomNumber: str('101'), capacity: num(30) }, {
        alias: 'room101',
      }),
      create('TeacherCourse', {
        Teacher: id('mathTeacher'),
        Course: id('algebra'),
      }),
      create('TeacherCourse', {
        Teacher: id('sciTeacher'),
        Course: id('physics'),
      }),
      create('CourseClassroom', {
        Course: id('algebra'),
        Classroom: id('room101'),
      }),
    ], { isPublic: true });
    expect(code).toContain('@public workflow SeedSampleData');
    expect(code).toContain('{Teacher {name "Dr. Smith", department "Mathematics"}} @as mathTeacher');
    expect(code).toContain('{Teacher {name "Prof. Jones", department "Science"}} @as sciTeacher');
    expect(code).toContain('{Course {name "Algebra 101", credits 3}} @as algebra');
    expect(code).toContain('{Course {name "Physics 201", credits 4}} @as physics');
    expect(code).toContain('{Classroom {building "Science Hall", roomNumber "101", capacity 30}} @as room101');
    expect(code).toContain('{TeacherCourse {Teacher mathTeacher, Course algebra}}');
    expect(code).toContain('{TeacherCourse {Teacher sciTeacher, Course physics}}');
    expect(code).toContain('{CourseClassroom {Course algebra, Classroom room101}}');
  });

  // 14. Teacher courses — nested relationship query with @into
  test('TeacherCourses — nested relationships with @into', () => {
    const code = workflow('TeacherCourses', [
      query('Teacher', { id: { value: ref('TeacherCourses', 'teacherId') } }, {
        relationships: {
          TeacherCourse: query('Course', {}, {
            relationships: {
              CourseClassroom: query('Classroom'),
            },
          }),
        },
        into: {
          teacherName: 'Teacher.name',
          courseName: 'Course.name',
          building: 'Classroom.building',
          roomNumber: 'Classroom.roomNumber',
        },
      }),
    ], { isPublic: true });
    expect(code).toContain('@public workflow TeacherCourses');
    expect(code).toContain('{Teacher {id? TeacherCourses.teacherId}');
    expect(code).toContain('TeacherCourse {Course? {}');
    expect(code).toContain('CourseClassroom {Classroom? {}}');
    expect(code).toContain('@into {teacherName Teacher.name');
    expect(code).toContain('courseName Course.name');
    expect(code).toContain('building Classroom.building');
    expect(code).toContain('roomNumber Classroom.roomNumber}');
  });

  // 15. Promote students — forEach + @where + queryUpdate + @withRole
  test('PromoteStudents — forEach with @where filter + queryUpdate', () => {
    const code = workflow('PromoteStudents', [
      forEach(
        'grade',
        query('Grade', {
          courseId: { value: ref('PromoteStudents', 'courseId') },
        }, {
          where: [
            { lhs: 'score', op: '>=', rhs: num(60) },
          ],
        }),
        [
          queryUpdate('Grade',
            {
              studentId: { value: ref('grade', 'studentId') },
              courseId: { value: ref('PromoteStudents', 'courseId') },
            },
            {
              status: str('passed'),
            },
          ),
        ],
      ),
    ], { isPublic: true, withRole: 'admin' });
    expect(code).toContain('@public workflow PromoteStudents @withRole(admin)');
    expect(code).toContain('for grade in {Grade {courseId? PromoteStudents.courseId}');
    expect(code).toContain('@where {score?>= 60}');
    expect(code).toContain('{Grade {studentId? grade.studentId, courseId? PromoteStudents.courseId, status "passed"}}');
  });
});
