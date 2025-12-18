// index.ts
import * as path from 'path';
import * as restify from 'restify';
import { BotFrameworkAdapter, ConversationState, MemoryStorage } from 'botbuilder';
import { FaqBot } from './FaqBot';
import { config } from 'dotenv';

// 1. Carrega as variáveis de ambiente
config(); 

console.log("AppId:", process.env.MicrosoftAppId ? "Carregado" : "Não encontrado");
console.log("TenantId:", process.env.MicrosoftAppTenantId ? "Carregado" : "Não encontrado");

// 2. CONFIGURAÇÃO DE PROXY (Adicione isto aqui)
// Isso garante que o Node não tente usar proxy para chamadas locais
process.env.NO_PROXY = process.env.NO_PROXY || 'localhost,127.0.0.1,::1';

// Se você estiver atrás de um proxy corporativo e precisar autenticar com a Azure
// para publicar depois, você pode precisar definir também:
// process.env.HTTP_PROXY = 'http://seu-proxy:porta';
// process.env.HTTPS_PROXY = 'http://seu-proxy:porta';

// Cria o servidor HTTP
const server = restify.createServer();


server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${server.name} ouvindo em ${server.url}`);
    console.log('\nUse o Bot Framework Emulator para testar');
});

const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    channelAuthTenant: process.env.MicrosoftAppTenantId
});

adapter.onTurnError = async (context, error) => {
    console.error(`\n [onTurnError] unhandled error: ${error}`);
    await context.sendActivity('Ocorreu um erro no bot.');
};

const memoryStorage = new MemoryStorage();
const conversationState = new ConversationState(memoryStorage);

const myBot = new FaqBot(conversationState);

// Rota com a correção do 'next'
server.post('/api/messages', (req, res, next) => {
    adapter.processActivity(req, res, async (context) => {
        await myBot.run(context);
    });
});