/** SHA-256 over canonical JSON — node-only (server/tests). */
import {createHash} from 'node:crypto';
import {canonicalJSON} from './canon.js';

export const hashJSON = (value:unknown):string =>
  createHash('sha256').update(canonicalJSON(value),'utf8').digest('hex');
