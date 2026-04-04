import Datastore from '@seald-io/nedb';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import type { PipelineDoc, PipelineStage, TaskDoc } from '../shared/types.js';
import { sanitizeRepoPath } from './memory.js';

// Types for NeDB documents without the auto-generated _id
type NewPipelineDoc = Omit<PipelineDoc, '_id'>;
type NewTaskDoc = Omit<TaskDoc, '_id'>;

function getPipelineDir(repoPath: string): string {
  const sanitized = sanitizeRepoPath(repoPath);
  return path.join(app.getPath('userData'), 'pipelines', sanitized);
}

export interface PipelineDbOptions {
  /** Directory for DB files. If omitted, uses in-memory storage. */
  dir?: string;
}

export class PipelineDb {
  private pipelinesDb: Datastore<NewPipelineDoc>;
  private tasksDb: Datastore<NewTaskDoc>;
  private ready: Promise<void>;

  constructor(options: PipelineDbOptions = {}) {
    const pipelineOpts: Datastore.DataStoreOptions = { autoload: false };
    const taskOpts: Datastore.DataStoreOptions = { autoload: false };

    if (options.dir) {
      fs.mkdirSync(options.dir, { recursive: true });
      pipelineOpts.filename = path.join(options.dir, 'pipelines.db');
      taskOpts.filename = path.join(options.dir, 'tasks.db');
    }
    // If no dir, NeDB runs in-memory (no filename)

    this.pipelinesDb = new Datastore<NewPipelineDoc>(pipelineOpts);
    this.tasksDb = new Datastore<NewTaskDoc>(taskOpts);
    this.ready = this.init();
  }

  /** Create a PipelineDb for a repo, using the standard userData directory. */
  static forRepo(repoPath: string): PipelineDb {
    return new PipelineDb({ dir: getPipelineDir(repoPath) });
  }

  /** Create an in-memory PipelineDb (for testing). */
  static inMemory(): PipelineDb {
    return new PipelineDb();
  }

  private async init(): Promise<void> {
    await this.pipelinesDb.loadDatabaseAsync();
    await this.tasksDb.loadDatabaseAsync();
    await this.pipelinesDb.ensureIndexAsync({ fieldName: 'repoPath' });
    await this.tasksDb.ensureIndexAsync({ fieldName: 'pipelineId' });
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  // ─── Pipelines ───

  async createPipeline(doc: NewPipelineDoc): Promise<PipelineDoc> {
    await this.ensureReady();
    const inserted = await this.pipelinesDb.insertAsync(doc);
    return inserted as PipelineDoc;
  }

  async getPipeline(id: string): Promise<PipelineDoc | null> {
    await this.ensureReady();
    const doc = await this.pipelinesDb.findOneAsync({ _id: id });
    return (doc as PipelineDoc) ?? null;
  }

  async updatePipeline(id: string, update: Partial<PipelineDoc>): Promise<void> {
    await this.ensureReady();
    const { _id, ...fields } = update;
    await this.pipelinesDb.updateAsync({ _id: id }, { $set: fields }, {});
  }

  async updatePipelineStage(pipelineId: string, stageIndex: number, update: Partial<PipelineStage>): Promise<void> {
    await this.ensureReady();
    const setFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(update)) {
      setFields[`stages.${stageIndex}.${key}`] = value;
    }
    await this.pipelinesDb.updateAsync({ _id: pipelineId }, { $set: setFields }, {});
  }

  async listPipelines(): Promise<PipelineDoc[]> {
    await this.ensureReady();
    const docs = await this.pipelinesDb.findAsync({}).sort({ createdAt: -1 });
    return docs as PipelineDoc[];
  }

  // ─── Tasks ───

  async createTask(doc: NewTaskDoc): Promise<TaskDoc> {
    await this.ensureReady();
    const inserted = await this.tasksDb.insertAsync(doc);
    return inserted as TaskDoc;
  }

  async getTask(id: string): Promise<TaskDoc | null> {
    await this.ensureReady();
    const doc = await this.tasksDb.findOneAsync({ _id: id });
    return (doc as TaskDoc) ?? null;
  }

  async updateTask(id: string, update: Partial<TaskDoc>): Promise<void> {
    await this.ensureReady();
    const { _id, ...fields } = update;
    await this.tasksDb.updateAsync({ _id: id }, { $set: { ...fields, updatedAt: new Date().toISOString() } }, {});
  }

  async findTasks(query: Record<string, unknown>): Promise<TaskDoc[]> {
    await this.ensureReady();
    const docs = await this.tasksDb.findAsync(query).sort({ priority: 1, createdAt: 1 });
    return docs as TaskDoc[];
  }

  async listTasksForPipeline(pipelineId: string): Promise<TaskDoc[]> {
    return this.findTasks({ pipelineId });
  }
}

// ─── Singleton cache keyed by repo path ───

const dbCache = new Map<string, PipelineDb>();

export function getPipelineDb(repoPath: string): PipelineDb {
  const key = sanitizeRepoPath(repoPath);
  let db = dbCache.get(key);
  if (!db) {
    db = PipelineDb.forRepo(repoPath);
    dbCache.set(key, db);
  }
  return db;
}
