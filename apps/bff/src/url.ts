/** Prints the console's address with its launch token, for when the startup output has scrolled away. */
import { consoleUrl, loadConfig } from './config.ts'
import { loadSecrets } from './security/session.ts'

const config = loadConfig()
console.log(consoleUrl(config, loadSecrets(config.dataDir).token))
