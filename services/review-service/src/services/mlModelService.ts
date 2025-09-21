import * as tf from '@tensorflow/tfjs-node';
import natural from 'natural';
import Sentiment from 'sentiment';
import { logger } from '../utils/logger';

const sentiment = new Sentiment();
const tokenizer = new natural.WordTokenizer();
const TfIdf = natural.TfIdf;

interface ReviewFeatures {
  sentimentScore: number;
  sentimentExtremity: number;
  textLength: number;
  wordCount: number;
  uniqueWordRatio: number;
  capitalLetterRatio: number;
  punctuationRatio: number;
  emojiCount: number;
  specificityScore: number;
  grammarScore: number;
  repetitionScore: number;
  brandMentionCount: number;
  technicalTermCount: number;
}

export class MLModelService {
  private genuinenessModel: tf.LayersModel | null = null;
  private tfidf: any;
  private productKeywords: Set<string>;
  private technicalTerms: Set<string>;
  private readonly modelPath = process.env.ML_MODEL_PATH || './models/review_genuineness_model';

  constructor() {
    this.tfidf = new TfIdf();
    this.productKeywords = new Set([
      'quality', 'size', 'color', 'material', 'fabric', 'fit', 'comfort',
      'delivery', 'packaging', 'price', 'value', 'design', 'style'
    ]);
    this.technicalTerms = new Set([
      'cotton', 'polyester', 'silk', 'wool', 'leather', 'plastic', 'metal',
      'resolution', 'battery', 'screen', 'processor', 'memory', 'storage'
    ]);
  }

  async initialize(): Promise<void> {
    try {
      // Load pre-trained model if exists, otherwise create a new one
      try {
        this.genuinenessModel = await tf.loadLayersModel(`file://${this.modelPath}/model.json`);
        logger.info('Loaded pre-trained genuineness model');
      } catch (error) {
        logger.info('Creating new genuineness model');
        this.genuinenessModel = this.createGenuinenessModel();
      }
    } catch (error) {
      logger.error('Failed to initialize ML models:', error);
      throw error;
    }
  }

  private createGenuinenessModel(): tf.LayersModel {
    // Create a neural network for genuineness detection
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [13], // Number of features
          units: 64,
          activation: 'relu'
        }),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({
          units: 32,
          activation: 'relu'
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 16,
          activation: 'relu'
        }),
        tf.layers.dense({
          units: 1,
          activation: 'sigmoid' // Output between 0 and 1
        })
      ]
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });

    return model;
  }

  async predictGenuineness(reviewText: string, metadata?: any): Promise<number> {
    try {
      // Extract features from review text
      const features = this.extractFeatures(reviewText);

      // Convert features to tensor
      const inputTensor = tf.tensor2d([Object.values(features)]);

      // Make prediction
      const prediction = this.genuinenessModel!.predict(inputTensor) as tf.Tensor;
      const genuinenessScore = (await prediction.data())[0];

      // Clean up tensors
      inputTensor.dispose();
      prediction.dispose();

      // Apply additional heuristics based on metadata
      let adjustedScore = genuinenessScore;

      if (metadata) {
        // Boost score for verified purchases
        if (metadata.isVerifiedPurchase) {
          adjustedScore = Math.min(1, adjustedScore * 1.2);
        }

        // Reduce score for new accounts with many reviews
        if (metadata.accountAge < 7 && metadata.reviewCount > 5) {
          adjustedScore = Math.max(0, adjustedScore * 0.7);
        }

        // Reduce score for accounts with all 5-star or 1-star reviews
        if (metadata.ratingVariance < 0.5) {
          adjustedScore = Math.max(0, adjustedScore * 0.8);
        }
      }

      return Math.min(1, Math.max(0, adjustedScore));
    } catch (error) {
      logger.error('Failed to predict genuineness:', error);
      return 0.5; // Return neutral score on error
    }
  }

  private extractFeatures(reviewText: string): ReviewFeatures {
    const words = tokenizer.tokenize(reviewText.toLowerCase());
    const uniqueWords = new Set(words);

    // Sentiment analysis
    const sentimentResult = sentiment.analyze(reviewText);

    // Calculate features
    return {
      sentimentScore: this.normalizeSentiment(sentimentResult.score),
      sentimentExtremity: this.calculateSentimentExtremity(sentimentResult.score),
      textLength: Math.min(1, reviewText.length / 1000),
      wordCount: Math.min(1, words.length / 200),
      uniqueWordRatio: uniqueWords.size / Math.max(1, words.length),
      capitalLetterRatio: this.calculateCapitalRatio(reviewText),
      punctuationRatio: this.calculatePunctuationRatio(reviewText),
      emojiCount: this.countEmojis(reviewText) / 10,
      specificityScore: this.calculateSpecificity(words),
      grammarScore: this.calculateGrammarScore(reviewText),
      repetitionScore: this.calculateRepetition(words),
      brandMentionCount: Math.min(1, this.countBrandMentions(reviewText) / 5),
      technicalTermCount: Math.min(1, this.countTechnicalTerms(words) / 10)
    };
  }

  private normalizeSentiment(score: number): number {
    // Normalize sentiment score to 0-1 range
    return (score + 10) / 20; // Assuming sentiment ranges from -10 to +10
  }

  private calculateSentimentExtremity(score: number): number {
    // High extremity for very positive or very negative
    return Math.abs(score) / 10;
  }

  private calculateCapitalRatio(text: string): number {
    const capitals = text.match(/[A-Z]/g);
    return capitals ? capitals.length / Math.max(1, text.length) : 0;
  }

  private calculatePunctuationRatio(text: string): number {
    const punctuation = text.match(/[.,!?;:]/g);
    return punctuation ? punctuation.length / Math.max(1, text.length) : 0;
  }

  private countEmojis(text: string): number {
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    const matches = text.match(emojiRegex);
    return matches ? matches.length : 0;
  }

  private calculateSpecificity(words: string[]): number {
    let specificCount = 0;
    for (const word of words) {
      if (this.productKeywords.has(word)) {
        specificCount++;
      }
    }
    return Math.min(1, specificCount / Math.max(1, words.length) * 10);
  }

  private calculateGrammarScore(text: string): number {
    // Simple grammar check based on sentence structure
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    let validSentences = 0;

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      // Check if sentence starts with capital and has reasonable length
      if (trimmed.length > 0 && /^[A-Z]/.test(trimmed) && trimmed.split(' ').length >= 3) {
        validSentences++;
      }
    }

    return sentences.length > 0 ? validSentences / sentences.length : 0;
  }

  private calculateRepetition(words: string[]): number {
    if (words.length === 0) return 0;

    const wordCounts = new Map<string, number>();
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // Count words that appear more than twice
    let repetitiveWords = 0;
    for (const count of wordCounts.values()) {
      if (count > 2) repetitiveWords++;
    }

    return Math.min(1, repetitiveWords / Math.max(1, wordCounts.size));
  }

  private countBrandMentions(text: string): number {
    // Count mentions of common fake review patterns
    const brandPatterns = [
      /highly recommend/gi,
      /best product/gi,
      /amazing quality/gi,
      /perfect/gi,
      /excellent/gi,
      /wonderful/gi,
      /fantastic/gi
    ];

    let count = 0;
    for (const pattern of brandPatterns) {
      const matches = text.match(pattern);
      if (matches) count += matches.length;
    }

    return count;
  }

  private countTechnicalTerms(words: string[]): number {
    let count = 0;
    for (const word of words) {
      if (this.technicalTerms.has(word)) {
        count++;
      }
    }
    return count;
  }

  async trainModel(trainingData: { text: string; isGenuine: boolean }[]): Promise<void> {
    if (!this.genuinenessModel) {
      throw new Error('Model not initialized');
    }

    // Prepare training data
    const features: number[][] = [];
    const labels: number[] = [];

    for (const sample of trainingData) {
      const extractedFeatures = this.extractFeatures(sample.text);
      features.push(Object.values(extractedFeatures));
      labels.push(sample.isGenuine ? 1 : 0);
    }

    // Convert to tensors
    const xs = tf.tensor2d(features);
    const ys = tf.tensor2d(labels, [labels.length, 1]);

    // Train the model
    await this.genuinenessModel.fit(xs, ys, {
      epochs: 50,
      batchSize: 32,
      validationSplit: 0.2,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          logger.info(`Epoch ${epoch}: loss = ${logs?.loss.toFixed(4)}, accuracy = ${logs?.acc.toFixed(4)}`);
        }
      }
    });

    // Clean up tensors
    xs.dispose();
    ys.dispose();

    // Save the trained model
    await this.saveModel();
  }

  private async saveModel(): Promise<void> {
    if (!this.genuinenessModel) return;

    try {
      await this.genuinenessModel.save(`file://${this.modelPath}`);
      logger.info('Model saved successfully');
    } catch (error) {
      logger.error('Failed to save model:', error);
    }
  }

  detectAnomalies(reviewText: string): string[] {
    const anomalies: string[] = [];

    // Check for excessive capitals
    const capitalRatio = this.calculateCapitalRatio(reviewText);
    if (capitalRatio > 0.5) {
      anomalies.push('excessive_capitals');
    }

    // Check for repetitive phrases
    const sentences = reviewText.split(/[.!?]+/);
    const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
    if (uniqueSentences.size < sentences.length * 0.8) {
      anomalies.push('repetitive_content');
    }

    // Check for generic phrases
    const genericPhrases = [
      'great product',
      'good quality',
      'fast delivery',
      'as described',
      'will buy again'
    ];
    const lowerText = reviewText.toLowerCase();
    let genericCount = 0;
    for (const phrase of genericPhrases) {
      if (lowerText.includes(phrase)) genericCount++;
    }
    if (genericCount >= 3) {
      anomalies.push('generic_content');
    }

    // Check for suspicious patterns
    if (reviewText.includes('http://') || reviewText.includes('https://')) {
      anomalies.push('contains_links');
    }

    if (reviewText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)) {
      anomalies.push('contains_email');
    }

    if (reviewText.match(/\+?\d{10,}/)) {
      anomalies.push('contains_phone');
    }

    return anomalies;
  }

  calculateSimilarity(review1: string, review2: string): number {
    // Use TF-IDF for similarity calculation
    this.tfidf.addDocument(review1);
    this.tfidf.addDocument(review2);

    const terms1: Set<string> = new Set();
    const terms2: Set<string> = new Set();

    this.tfidf.listTerms(0).forEach((item: any) => {
      terms1.add(item.term);
    });

    this.tfidf.listTerms(1).forEach((item: any) => {
      terms2.add(item.term);
    });

    // Calculate Jaccard similarity
    const intersection = new Set([...terms1].filter(x => terms2.has(x)));
    const union = new Set([...terms1, ...terms2]);

    return intersection.size / Math.max(1, union.size);
  }
}

let mlModelService: MLModelService | null = null;

export async function initializeMLModels(): Promise<void> {
  mlModelService = new MLModelService();
  await mlModelService.initialize();
}

export function getMLModelService(): MLModelService {
  if (!mlModelService) {
    throw new Error('ML models not initialized');
  }
  return mlModelService;
}