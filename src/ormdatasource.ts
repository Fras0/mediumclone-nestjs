import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { DataSource } from 'typeorm';
import config from './ormconfig';

export default new DataSource(config);
