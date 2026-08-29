import { Injectable, Logger } from '@nestjs/common';
// ConfigService is a value import on purpose — see the note in
// apps/api/src/health/health.controller.ts (constructor-injected dependency).
import { ConfigService } from '@nestjs/config';
import {
  HeadBucketCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.schema';
import type { StorageProvider } from './storage-provider.interface';

/**
 * S3-compatible implementation of StorageProvider. Works against MinIO
 * locally and any real S3-compatible provider in production by pointing
 * STORAGE_ENDPOINT elsewhere — no code change. See
 * docs/adr/0007-map-and-storage-provider-abstraction.md.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService<Env, true>) {
    this.bucket = configService.get('STORAGE_BUCKET', { infer: true });
    this.client = new S3Client({
      endpoint: `${configService.get('STORAGE_USE_SSL', { infer: true }) ? 'https' : 'http'}://${configService.get(
        'STORAGE_ENDPOINT',
        { infer: true },
      )}:${configService.get('STORAGE_PORT', { infer: true })}`,
      region: 'us-east-1', // required by the SDK; meaningless for MinIO/most S3-compatible providers
      forcePathStyle: true, // required for MinIO and most non-AWS S3-compatible providers
      credentials: {
        accessKeyId: configService.get('STORAGE_ACCESS_KEY', { infer: true }),
        secretAccessKey: configService.get('STORAGE_SECRET_KEY', { infer: true }),
      },
    });
  }

  async putObject(key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getSignedReadUrl(key: string, ttlSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      this.logger.warn(`Storage bucket unreachable: ${(error as Error).message}`);
      return false;
    }
  }
}
