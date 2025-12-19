export interface FaqOption {
    label: string;
    nextId: string;
}

export interface FaqNode {
    id: string;
    text: string;
    inputType?: 'button' | 'select';
    options: FaqOption[];
}

// Interface para o Estado da Conversa (onde o usuário está na árvore)
export interface UserStateData {
    currentNodeId: string;
    history: string[]; // Pilha para armazenar o histórico de navegação
}