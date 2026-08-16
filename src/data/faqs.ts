export interface FAQItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  tags: string[];
}

export interface FAQCategory {
  id: string;
  name: string;
  description: string;
  iconName: string; // Used to pick lucide-react icon
}
