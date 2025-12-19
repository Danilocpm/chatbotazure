import {
    ActivityHandler,
    MessageFactory,
    CardFactory,
    TurnContext,
    ConversationState,
    StatePropertyAccessor
} from 'botbuilder';
import * as fs from 'fs';
import * as path from 'path';
import { FaqNode, UserStateData } from './types';

// Carrega o JSON
const rawData = fs.readFileSync(path.join(__dirname, '..', 'faq.json'), 'utf8');
const faqData: FaqNode[] = JSON.parse(rawData);

export class FaqBot extends ActivityHandler {
    private conversationState: ConversationState;
    private userStateAccessor: StatePropertyAccessor<UserStateData>;

    constructor(conversationState: ConversationState) {
        super();
        this.conversationState = conversationState;
        // Cria o acessor para ler/gravar o estado
        this.userStateAccessor = this.conversationState.createProperty<UserStateData>('USER_STATE');

        // Evento: Quando alguém entra na conversa (Boas vindas)
        this.onMembersAdded(async (context, next) => {
            // Removido para que o bot só responda quando o usuário enviar uma mensagem
            await next();
        });

        // Evento: Quando o usuário envia uma mensagem
        this.onMessage(async (context, next) => {
            // Envia um typing indicator para mostrar que o bot está processando
            await context.sendActivity({ type: 'typing' });
            
            let text = context.activity.text;
            const value = context.activity.value;
            
            // Recupera estado (com default para history)
            const currentState = await this.userStateAccessor.get(context, { currentNodeId: 'root', history: [] });

            // 0. Verifica se está aguardando decisão de reinício
            if (currentState.currentNodeId === 'WAITING_RESET') {
                const textLower = (text || '').toLowerCase();
                if (value === 'reset' || textLower === 'reset' || textLower.includes('sim')) {
                    // Reinicia
                    await this.userStateAccessor.set(context, { currentNodeId: 'root', history: [] });
                    await this.displayNode(context, faqData.find(n => n.id === 'root'), false);
                } else if (value === 'exit' || textLower === 'exit' || textLower.includes('não') || textLower.includes('nao')) {
                    // Encerra
                    await context.sendActivity("Atendimento encerrado. Até logo!");
                    await this.userStateAccessor.delete(context);
                } else {
                    // Re-exibe o menu de decisão
                    const card = CardFactory.heroCard(
                        '',
                        'Deseja realizar outra pergunta?',
                        [],
                        [
                            { type: 'imBack', title: 'Sim', value: 'reset' },
                            { type: 'imBack', title: 'Não', value: 'exit' }
                        ]
                    );
                    await context.sendActivity(MessageFactory.attachment(card));
                }
                await next();
                return;
            }

            // 1. Verifica se é uma ação de Adaptive Card (Select)
            if (value && value.userChoice) {
                text = value.userChoice;
            }

            // 2. Verifica comandos de navegação (Back/Home)
            let action = '';
            if (value && value.action) {
                action = value.action;
            } else if (text) {
                if (text.toLowerCase() === 'voltar') action = 'back';
                if (text.toLowerCase() === 'início' || text.toLowerCase() === 'inicio') action = 'home';
            }

            // Ação: Voltar
            if (action === 'back') {
                if (currentState.history.length > 0) {
                    const previousNodeId = currentState.history.pop();
                    await this.userStateAccessor.set(context, { ...currentState, currentNodeId: previousNodeId });
                    const prevNode = faqData.find(n => n.id === previousNodeId);
                    await this.displayNode(context, prevNode, currentState.history.length > 0);
                } else {
                    await context.sendActivity("Você já está no início.");
                    await this.displayNode(context, faqData.find(n => n.id === 'root'), false);
                }
                await next();
                return;
            }

            // Ação: Início
            if (action === 'home') {
                await this.userStateAccessor.set(context, { currentNodeId: 'root', history: [] });
                await this.displayNode(context, faqData.find(n => n.id === 'root'), false);
                await next();
                return;
            }

            // 3. Navegação Normal
            const currentNode = faqData.find(n => n.id === currentState.currentNodeId);
            
            if (!currentNode) {
                // Se perdeu o estado, volta pro root
                await this.userStateAccessor.set(context, { currentNodeId: 'root', history: [] });
                await this.displayNode(context, faqData.find(n => n.id === 'root'), false);
                return;
            }

            // Tenta encontrar a opção escolhida
            const selectedOption = currentNode.options.find(o => o.label.toLowerCase() === (text || '').toLowerCase());

            if (selectedOption) {
                // Push no histórico
                currentState.history.push(currentNode.id);
                await this.userStateAccessor.set(context, { ...currentState, currentNodeId: selectedOption.nextId });
                
                const nextNode = faqData.find(n => n.id === selectedOption.nextId);
                if (nextNode) {
                    await this.displayNode(context, nextNode, true); // true pq agora tem histórico
                    
                    // Se for nó final (sem opções)
                    if (nextNode.options.length === 0) {
                        // Pergunta se quer reiniciar
                        const card = CardFactory.heroCard(
                            '',
                            'Deseja realizar outra pergunta?',
                            [],
                            [
                                { type: 'imBack', title: 'Sim', value: 'reset' },
                                { type: 'imBack', title: 'Não', value: 'exit' }
                            ]
                        );
                        await context.sendActivity(MessageFactory.attachment(card));
                        
                        // Define estado de espera
                        await this.userStateAccessor.set(context, { ...currentState, currentNodeId: 'WAITING_RESET' });
                    }
                }
            } else {
                // Se estiver na raiz e for a primeira interação (ou input inválido na raiz), mostra o menu inicial sem erro
                if (currentState.currentNodeId === 'root' && currentState.history.length === 0) {
                     await this.displayNode(context, currentNode, false);
                } else {
                     await context.sendActivity("Opção inválida ou não reconhecida.");
                     await this.displayNode(context, currentNode, currentState.history.length > 0);
                }
            }

            await next();
        });

        // Salva o estado ao final do turno
        this.onDialog(async (context, next) => {
            await next();
            await this.conversationState.saveChanges(context, false);
        });
    }

    // Função auxiliar removida pois a lógica foi movida para onMessage/displayNode para gerenciar histórico
    // private async updateAndShowNode(...) {}

    // Função para renderizar a resposta
    private async displayNode(context: TurnContext, node: FaqNode | undefined, showBack: boolean) {
        if (!node) return;

        let message;

        // Verifica o tipo de input
        if (node.inputType === 'select') {
            // Renderiza Adaptive Card com Dropdown
            const choices = node.options.map(opt => ({ title: opt.label, value: opt.label }));
            
            const card = CardFactory.adaptiveCard({
                type: "AdaptiveCard",
                version: "1.0",
                body: [
                    { type: "TextBlock", text: node.text, wrap: true, weight: "Bolder" },
                    {
                        type: "Input.ChoiceSet",
                        id: "userChoice",
                        style: "compact",
                        choices: choices
                    }
                ],
                actions: [
                    { type: "Action.Submit", title: "Enviar" }
                ]
            });
            message = MessageFactory.attachment(card);

        } else {
            // Default: HeroCard (Botões)
            const buttons = node.options.map(opt => ({
                type: 'imBack', // imBack envia a mensagem no chat
                title: opt.label,
                value: opt.label
            }));

            const card = CardFactory.heroCard(
                '', // Título opcional
                node.text, // Texto principal
                [], // Imagens
                buttons // Botões
            );

            message = MessageFactory.attachment(card);
        }

        // Suggested Actions (Botões flutuantes de navegação)
        const navActions = [];
        
        if (showBack) {
            navActions.push({ type: 'imBack', title: '⬅ Voltar', value: 'Voltar' });
        }
        
        if (node.id !== 'root') {
            navActions.push({ type: 'imBack', title: '🏠 Início', value: 'Início' });
        }

        if (navActions.length > 0) {
            message.suggestedActions = { actions: navActions, to: [] };
        }

        await context.sendActivity(message);
    }
}