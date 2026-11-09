import { and, eq } from 'drizzle-orm';

import { db, postgresClient } from '../client';

import { lgas } from '../schema/organisation';
import {
  serviceYears,
  batches,
  streams
} from '../schema/cohorts';

import {
  institutions,
  courses
} from '../schema/academics';
import {
  courseAliases
} from '../schema/course-aliases';

import {
  users,
  roles
} from '../schema/identity';

import {
  userRoleAssignments
} from '../schema/user-role-assignments';

import { corpsMembers } from '../schema/corps-members';

// Get existing record or create a new one.
async function getRole(code: string, name: string, description: string) {
  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, code))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(roles)
    .values({ code, name, description })
    .onConflictDoNothing()
    .returning({ id: roles.id });

  if (created) return created.id;

  const [record] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, code))
    .limit(1);

  if (!record) throw new Error(`Could not create role: ${code}`);

  return record.id;
}

async function getUser(email: string) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(users)
    .values({
      email,
      status: 'pending_activation'
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (created) return created.id;

  const [record] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!record) throw new Error(`Could not create user: ${email}`);

  return record.id;
}

async function assignRole(
  userId: string,
  roleId: string,
  lgaId: string
) {
  const [existing] = await db
    .select({ id: userRoleAssignments.id })
    .from(userRoleAssignments)
    .where(
      and(
        eq(userRoleAssignments.userId, userId),
        eq(userRoleAssignments.roleId, roleId),
        eq(userRoleAssignments.lgaId, lgaId)
      )
    )
    .limit(1);

  if (existing) return;

  await db.insert(userRoleAssignments).values({
    userId,
    roleId,
    lgaId
  });
}


async function removeLegacyPlatformAdminDemoAccount() {
  // Remove the separate Platform Administrator demo account introduced by
  // an earlier development seed. User-owned sessions, tokens and role
  // assignments are removed through their foreign-key cascade rules.
  await db
    .delete(users)
    .where(eq(users.email, 'platform.admin@example.test'));

  const [legacyRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, 'PLATFORM_ADMIN'))
    .limit(1);

  if (legacyRole) {
    const [remainingAssignment] = await db
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(eq(userRoleAssignments.roleId, legacyRole.id))
      .limit(1);

    if (!remainingAssignment) {
      await db.delete(roles).where(eq(roles.id, legacyRole.id));
    }
  }
}

async function main() {
  console.log('Starting NYSC database seeding...\n');
  await removeLegacyPlatformAdminDemoAccount();

  // 1. Create Demo LGA
  let [lga] = await db
    .select({ id: lgas.id })
    .from(lgas)
    .where(
      and(
        eq(lgas.name, 'Demo LGA'),
        eq(lgas.stateName, 'Demo State')
      )
    )
    .limit(1);

  if (!lga) {
    [lga] = await db
      .insert(lgas)
      .values({
        name: 'Demo LGA',
        stateName: 'Demo State',
        code: 'DEMO-LGA'
      })
      .returning({ id: lgas.id });
  }

  if (!lga) throw new Error('Failed to create Demo LGA');

  console.log('✓ Demo LGA created/found');

  // 2. Service Year
  let [year] = await db
    .select({ id: serviceYears.id })
    .from(serviceYears)
    .where(eq(serviceYears.year, 2026))
    .limit(1);

  if (!year) {
    [year] = await db
      .insert(serviceYears)
      .values({
        year: 2026,
        isActive: true
      })
      .returning({ id: serviceYears.id });
  }

  if (!year) throw new Error('Failed to create service year');

  console.log('✓ Service Year 2026 created/found');

  // 3. Batch A
  let [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(
      and(
        eq(batches.serviceYearId, year.id),
        eq(batches.code, 'A')
      )
    )
    .limit(1);

  if (!batch) {
    [batch] = await db
      .insert(batches)
      .values({
        serviceYearId: year.id,
        code: 'A',
        name: 'Batch A'
      })
      .returning({ id: batches.id });
  }

  if (!batch) throw new Error('Failed to create Batch A');

  console.log('✓ Batch A created/found');

  // 4. Stream I
  let [stream] = await db
    .select({ id: streams.id })
    .from(streams)
    .where(
      and(
        eq(streams.batchId, batch.id),
        eq(streams.code, 'I')
      )
    )
    .limit(1);

  if (!stream) {
    [stream] = await db
      .insert(streams)
      .values({
        batchId: batch.id,
        code: 'I',
        name: 'Stream I'
      })
      .returning({ id: streams.id });
  }

  if (!stream) throw new Error('Failed to create Stream I');

  console.log('✓ Stream I created/found');

  // 5. Institution
  let [institution] = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.name, 'Demo University'))
    .limit(1);

  if (!institution) {
    [institution] = await db
      .insert(institutions)
      .values({
        name: 'Demo University',
        abbreviation: 'DU',
        institutionType: 'University'
      })
      .returning({ id: institutions.id });
  }

  if (!institution) throw new Error('Failed to create institution');

  console.log('✓ Demo University created/found');

  // 6. Academic courses
  const courseData = [
    {
      name: 'Computer Science',
      normalizedName: 'COMPUTER SCIENCE',
      disciplineCategory: 'ICT'
    },
    {
      name: 'Software Engineering',
      normalizedName: 'SOFTWARE ENGINEERING',
      disciplineCategory: 'ICT'
    },
    {
      name: 'Nursing',
      normalizedName: 'NURSING',
      disciplineCategory: 'HEALTH'
    },
    {
      name: 'Law',
      normalizedName: 'LAW',
      disciplineCategory: 'LEGAL'
    },
    {
      name: 'Agricultural Science',
      normalizedName: 'AGRICULTURAL SCIENCE',
      disciplineCategory: 'AGRICULTURE'
    },
    { name: 'Accounting', normalizedName: 'ACCOUNTING', disciplineCategory: 'MANAGEMENT_SCIENCES' },
    { name: 'Business Administration', normalizedName: 'BUSINESS ADMINISTRATION', disciplineCategory: 'MANAGEMENT_SCIENCES' },
    { name: 'Economics', normalizedName: 'ECONOMICS', disciplineCategory: 'SOCIAL_SCIENCES' },
    { name: 'Political Science', normalizedName: 'POLITICAL SCIENCE', disciplineCategory: 'SOCIAL_SCIENCES' },
    { name: 'Sociology', normalizedName: 'SOCIOLOGY', disciplineCategory: 'SOCIAL_SCIENCES' },
    { name: 'Psychology', normalizedName: 'PSYCHOLOGY', disciplineCategory: 'SOCIAL_SCIENCES' },
    { name: 'Mass Communication', normalizedName: 'MASS COMMUNICATION', disciplineCategory: 'ARTS_HUMANITIES' },
    { name: 'English Language', normalizedName: 'ENGLISH LANGUAGE', disciplineCategory: 'ARTS_HUMANITIES' },
    { name: 'History and International Studies', normalizedName: 'HISTORY AND INTERNATIONAL STUDIES', disciplineCategory: 'ARTS_HUMANITIES' },
    { name: 'Biochemistry', normalizedName: 'BIOCHEMISTRY', disciplineCategory: 'NATURAL_SCIENCES' },
    { name: 'Microbiology', normalizedName: 'MICROBIOLOGY', disciplineCategory: 'NATURAL_SCIENCES' },
    { name: 'Chemistry', normalizedName: 'CHEMISTRY', disciplineCategory: 'NATURAL_SCIENCES' },
    { name: 'Physics', normalizedName: 'PHYSICS', disciplineCategory: 'NATURAL_SCIENCES' },
    { name: 'Mathematics', normalizedName: 'MATHEMATICS', disciplineCategory: 'NATURAL_SCIENCES' },
    { name: 'Statistics', normalizedName: 'STATISTICS', disciplineCategory: 'NATURAL_SCIENCES' },
    { name: 'Civil Engineering', normalizedName: 'CIVIL ENGINEERING', disciplineCategory: 'ENGINEERING' },
    { name: 'Electrical and Electronics Engineering', normalizedName: 'ELECTRICAL AND ELECTRONICS ENGINEERING', disciplineCategory: 'ENGINEERING' },
    { name: 'Mechanical Engineering', normalizedName: 'MECHANICAL ENGINEERING', disciplineCategory: 'ENGINEERING' },
    { name: 'Chemical Engineering', normalizedName: 'CHEMICAL ENGINEERING', disciplineCategory: 'ENGINEERING' },
    { name: 'Architecture', normalizedName: 'ARCHITECTURE', disciplineCategory: 'BUILT_ENVIRONMENT' },
    { name: 'Quantity Surveying', normalizedName: 'QUANTITY SURVEYING', disciplineCategory: 'BUILT_ENVIRONMENT' },
    { name: 'Urban and Regional Planning', normalizedName: 'URBAN AND REGIONAL PLANNING', disciplineCategory: 'BUILT_ENVIRONMENT' },
    { name: 'Environmental Management', normalizedName: 'ENVIRONMENTAL MANAGEMENT', disciplineCategory: 'ENVIRONMENTAL_SCIENCES' },
    { name: 'Geography', normalizedName: 'GEOGRAPHY', disciplineCategory: 'ENVIRONMENTAL_SCIENCES' },
    { name: 'Education and Biology', normalizedName: 'EDUCATION AND BIOLOGY', disciplineCategory: 'EDUCATION' },
    { name: 'Educational Management', normalizedName: 'EDUCATIONAL MANAGEMENT', disciplineCategory: 'EDUCATION' },
    { name: 'Pharmacy', normalizedName: 'PHARMACY', disciplineCategory: 'PHARMACEUTICAL_SCIENCES' },
    { name: 'Medical Laboratory Science', normalizedName: 'MEDICAL LABORATORY SCIENCE', disciplineCategory: 'HEALTH' },
    { name: 'Public Health', normalizedName: 'PUBLIC HEALTH', disciplineCategory: 'HEALTH' },
    { name: 'Physiotherapy', normalizedName: 'PHYSIOTHERAPY', disciplineCategory: 'HEALTH' },
    { name: 'Veterinary Medicine', normalizedName: 'VETERINARY MEDICINE', disciplineCategory: 'VETERINARY_MEDICINE' },
    { name: 'Computer Engineering', normalizedName: 'COMPUTER ENGINEERING', disciplineCategory: 'ENGINEERING' }
  ];

  const courseIds: Record<string, string> = {};

  for (const course of courseData) {
    let [record] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.normalizedName, course.normalizedName))
      .limit(1);

    if (!record) {
      [record] = await db
        .insert(courses)
        .values(course)
        .onConflictDoNothing()
        .returning({ id: courses.id });
    }

    if (!record) {
      const [existing] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.normalizedName, course.normalizedName))
        .limit(1);

      record = existing;
    }

    if (!record) {
      throw new Error(`Failed to create course: ${course.name}`);
    }

    courseIds[course.normalizedName] = record.id;

    console.log(`✓ Course: ${course.name}`);
  }

  // 6b. Add common course-name aliases to the shared catalogue.
  const aliasData: Record<string, string[]> = {
    'COMPUTER SCIENCE': ['Computing', 'Computer Studies'],
    'SOFTWARE ENGINEERING': ['Software Development'],
    'AGRICULTURAL SCIENCE': ['Agriculture', 'Agricultural Sciences'],
    'ACCOUNTING': ['Accountancy'],
    'BUSINESS ADMINISTRATION': ['Business Management'],
    'MASS COMMUNICATION': ['Mass Communications'],
    'ELECTRICAL AND ELECTRONICS ENGINEERING': ['Electrical Engineering'],
    'MEDICAL LABORATORY SCIENCE': ['Medical Laboratory Technology']
  };

  for (const [canonicalName, aliases] of Object.entries(aliasData)) {
    const courseId = courseIds[canonicalName];
    if (!courseId) continue;

    for (const alias of aliases) {
      const normalizedName = alias
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleUpperCase('en');

      const [existingAlias] = await db
        .select({ id: courseAliases.id })
        .from(courseAliases)
        .where(eq(courseAliases.normalizedName, normalizedName))
        .limit(1);

      if (existingAlias) continue;

      await db.insert(courseAliases).values({
        courseId,
        name: alias,
        normalizedName
      });
    }
  }

  // 7. Create system roles
  const lgiRole = await getRole(
    'LGI_ADMIN',
    'LGI Administrator',
    'Manages corps members and CDS administration within an LGA'
  );

  const coordinatorRole = await getRole(
    'CDS_COORDINATOR',
    'CDS Coordinator',
    'Coordinates assigned CDS groups'
  );

  const presidentRole = await getRole(
    'CDS_PRESIDENT',
    'CDS President',
    'Records attendance for assigned CDS groups'
  );

  await getRole(
    'CORPS_MEMBER',
    'Corps Member',
    'Registered NYSC corps member'
  );

  console.log('✓ System roles created/found');

  // 8. Create administrative accounts
  const lgiUserId = await getUser('lgi.demo@example.test');

  const coordinatorUserId = await getUser(
    'coordinator.demo@example.test'
  );

  const presidentUserId = await getUser(
    'president.demo@example.test'
  );

  await assignRole(lgiUserId, lgiRole, lga.id);

  await assignRole(coordinatorUserId, coordinatorRole, lga.id);

  await assignRole(presidentUserId, presidentRole, lga.id);

  console.log('✓ LGI, Coordinator and President test accounts created/found');

  // 9. Five synthetic corps members
  const members = [
    {
      stateCode: 'DEMO/26A/001',
      callUpNumber: 'DEMO-CALLUP-001',
      firstName: 'Amina',
      lastName: 'Bello',
      gender: 'Female',
      course: 'COMPUTER SCIENCE'
    },
    {
      stateCode: 'DEMO/26A/002',
      callUpNumber: 'DEMO-CALLUP-002',
      firstName: 'David',
      lastName: 'Okoro',
      gender: 'Male',
      course: 'SOFTWARE ENGINEERING'
    },
    {
      stateCode: 'DEMO/26A/003',
      callUpNumber: 'DEMO-CALLUP-003',
      firstName: 'Fatima',
      lastName: 'Ibrahim',
      gender: 'Female',
      course: 'NURSING'
    },
    {
      stateCode: 'DEMO/26A/004',
      callUpNumber: 'DEMO-CALLUP-004',
      firstName: 'Peter',
      lastName: 'Adeyemi',
      gender: 'Male',
      course: 'LAW'
    },
    {
      stateCode: 'DEMO/26A/005',
      callUpNumber: 'DEMO-CALLUP-005',
      firstName: 'Grace',
      lastName: 'Nwosu',
      gender: 'Female',
      course: 'AGRICULTURAL SCIENCE'
    }
  ];

  for (const member of members) {
    const [existing] = await db
      .select({ id: corpsMembers.id })
      .from(corpsMembers)
      .where(eq(corpsMembers.stateCode, member.stateCode))
      .limit(1);

    if (existing) {
      console.log(`↻ Member already exists: ${member.stateCode}`);
      continue;
    }

    await db.insert(corpsMembers).values({
      stateCode: member.stateCode,
      callUpNumber: member.callUpNumber,
      firstName: member.firstName,
      lastName: member.lastName,
      gender: member.gender,
      lgaId: lga.id,
      streamId: stream.id,
      institutionId: institution.id,
      courseId: courseIds[member.course],
      profileStatus: 'preloaded',
      createdByUserId: lgiUserId
    });

    console.log(`✓ Corps member created: ${member.firstName} ${member.lastName}`);
  }

  console.log('\n====================================');
  console.log('NYSC DATABASE SEEDING COMPLETED');
  console.log('====================================');
  console.log('LGA: Demo LGA');
  console.log('Cohort: 2026 / Batch A / Stream I');
  console.log('Administrative accounts: 4');
  console.log(`Course catalogue starter records: ${courseData.length}`);
  console.log('Corps members: 5');
  console.log('====================================');
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await postgresClient.end();
  });
