#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!uri) {
    console.error('Missing MongoDB URI. Set MONGODB_URI or MONGO_URI.');
    process.exit(1);
}

const asTime = (value) => {
    const t = new Date(value || 0).getTime();
    return Number.isFinite(t) ? t : 0;
};

const subjectKey = (subject) =>
    `${String(subject?.name || '').trim().toLowerCase()}::${String(subject?.code || '').trim().toLowerCase()}`;

async function countRefs(db, classId) {
    const [attendance, reports, announcements] = await Promise.all([
        db.collection('attendances').countDocuments({ classId }),
        db.collection('reports').countDocuments({ classId }),
        db.collection('announcements').countDocuments({ classId }),
    ]);

    return {
        attendance,
        reports,
        announcements,
        total: attendance + reports + announcements,
    };
}

function chooseCanonical(docs) {
    return [...docs].sort((a, b) => {
        if (b.refs.total !== a.refs.total) return b.refs.total - a.refs.total;
        const aSubjects = Array.isArray(a.subjects) ? a.subjects.length : 0;
        const bSubjects = Array.isArray(b.subjects) ? b.subjects.length : 0;
        if (bSubjects !== aSubjects) return bSubjects - aSubjects;
        return asTime(a.createdAt) - asTime(b.createdAt);
    })[0];
}

async function migrateAttendance(db, fromId, toId, summary) {
    const attendance = db.collection('attendances');
    const records = await attendance.find({ classId: fromId }).toArray();

    for (const record of records) {
        const existing = await attendance.findOne({ classId: toId, date: record.date });

        if (!existing) {
            await attendance.updateOne({ _id: record._id }, { $set: { classId: toId } });
            summary.attendanceMoved += 1;
            continue;
        }

        // Handle unique conflict on { classId, date } by keeping the most recently updated record.
        if (asTime(record.updatedAt) > asTime(existing.updatedAt)) {
            await attendance.updateOne(
                { _id: existing._id },
                {
                    $set: {
                        periods: record.periods || [],
                        updatedAt: record.updatedAt || new Date(),
                    },
                }
            );
            summary.attendanceReplaced += 1;
        } else {
            summary.attendanceKeptPrimary += 1;
        }

        await attendance.deleteOne({ _id: record._id });
        summary.attendanceRemovedFromDuplicate += 1;
    }
}

async function ensureCaseInsensitiveUniqueIndex(db, summary) {
    const classrooms = db.collection('classrooms');
    const indexes = await classrooms.indexes();

    const hasCiUnique = indexes.some(
        (idx) =>
            idx.name === 'className_ci_unique' &&
            idx.unique === true &&
            idx.collation &&
            idx.collation.locale === 'en' &&
            idx.collation.strength === 2
    );

    if (hasCiUnique) {
        summary.indexStatus = 'className_ci_unique already present';
        return;
    }

    if (indexes.some((idx) => idx.name === 'className_1')) {
        await classrooms.dropIndex('className_1');
        summary.indexDropped = 'className_1';
    }

    await classrooms.createIndex(
        { className: 1 },
        { name: 'className_ci_unique', unique: true, collation: { locale: 'en', strength: 2 } }
    );
    summary.indexCreated = 'className_ci_unique';
}

async function run() {
    const summary = {
        duplicateGroupsFound: 0,
        duplicateClassroomsDeleted: 0,
        reportsMoved: 0,
        announcementsMoved: 0,
        attendanceMoved: 0,
        attendanceReplaced: 0,
        attendanceKeptPrimary: 0,
        attendanceRemovedFromDuplicate: 0,
        indexDropped: null,
        indexCreated: null,
        indexStatus: null,
        actions: [],
    };

    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const db = mongoose.connection.db;
    const classrooms = db.collection('classrooms');
    const reports = db.collection('reports');
    const announcements = db.collection('announcements');

    const groups = await classrooms
        .aggregate([
            {
                $project: {
                    className: 1,
                    totalStudents: 1,
                    subjects: 1,
                    adminPin: 1,
                    createdAt: 1,
                    norm: { $toLower: { $trim: { input: '$className' } } },
                },
            },
            {
                $group: {
                    _id: '$norm',
                    docs: { $push: '$$ROOT' },
                    count: { $sum: 1 },
                },
            },
            { $match: { count: { $gt: 1 } } },
        ])
        .toArray();

    summary.duplicateGroupsFound = groups.length;

    for (const group of groups) {
        const withRefs = [];
        for (const doc of group.docs) {
            const refs = await countRefs(db, doc._id);
            withRefs.push({ ...doc, refs });
        }

        const canonical = chooseCanonical(withRefs);
        const duplicates = withRefs.filter((doc) => String(doc._id) !== String(canonical._id));

        const mergedSubjects = [...(Array.isArray(canonical.subjects) ? canonical.subjects : [])];
        const subjectSeen = new Set(mergedSubjects.map(subjectKey));
        let mergedTotalStudents = canonical.totalStudents || 0;

        for (const duplicate of duplicates) {
            await migrateAttendance(db, duplicate._id, canonical._id, summary);

            const reportMoveResult = await reports.updateMany(
                { classId: duplicate._id },
                { $set: { classId: canonical._id } }
            );
            summary.reportsMoved += reportMoveResult.modifiedCount;

            const announcementMoveResult = await announcements.updateMany(
                { classId: duplicate._id },
                { $set: { classId: canonical._id } }
            );
            summary.announcementsMoved += announcementMoveResult.modifiedCount;

            for (const subject of duplicate.subjects || []) {
                const key = subjectKey(subject);
                if (!subjectSeen.has(key)) {
                    subjectSeen.add(key);
                    mergedSubjects.push(subject);
                }
            }
            mergedTotalStudents = Math.max(mergedTotalStudents, duplicate.totalStudents || 0);

            await classrooms.deleteOne({ _id: duplicate._id });
            summary.duplicateClassroomsDeleted += 1;

            summary.actions.push({
                normalizedName: group._id,
                keptClassId: String(canonical._id),
                removedClassId: String(duplicate._id),
                keptClassName: canonical.className,
                removedClassName: duplicate.className,
                refsMoved: duplicate.refs,
            });
        }

        await classrooms.updateOne(
            { _id: canonical._id },
            {
                $set: {
                    className: String(canonical.className || '').trim(),
                    totalStudents: mergedTotalStudents,
                    subjects: mergedSubjects,
                },
            }
        );
    }

    const remainingDuplicates = await classrooms
        .aggregate([
            { $project: { norm: { $toLower: { $trim: { input: '$className' } } } } },
            { $group: { _id: '$norm', count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $count: 'n' },
        ])
        .toArray();

    if ((remainingDuplicates[0]?.n || 0) > 0) {
        throw new Error('Duplicate class names still exist after dedupe. Aborting index migration.');
    }

    await ensureCaseInsensitiveUniqueIndex(db, summary);

    const indexesAfter = await classrooms.indexes();
    summary.finalIndexes = indexesAfter;

    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error('Migration failed:', err.message);
    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }
    process.exit(1);
});
