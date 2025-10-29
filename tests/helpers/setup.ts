import { installNoNetwork } from './no-network';

// Block network requests in tests to ensure isolated unit testing
installNoNetwork();
