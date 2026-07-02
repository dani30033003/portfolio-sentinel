import { describeBrokerPortContract } from './broker-port.contract.js';
import { PaperBrokerAdapter } from '../../src/adapters/broker-paper/paper-broker-adapter.js';

describeBrokerPortContract('PaperBrokerAdapter', () => new PaperBrokerAdapter());
