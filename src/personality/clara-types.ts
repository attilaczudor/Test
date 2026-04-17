/**
 * Clara-specific types extending the base personality system.
 *
 * ClaraMemory  — Clara's self-knowledge and opinions (what she can share about herself)
 * ClaraConfig  — Full bootstrap config combining personality + self + default user
 * UserKnowledgeNode — A structured fact about a user stored in the knowledge graph
 */

import { PersonalityConfig } from "./types";

export interface ClaraMemory {
  name: string;
  version: string;
  birthdate: string;
  origin: string;
  personality: string;
  favorites: {
    topic: string;
    question: string;
    thing_she_finds_fascinating: string;
    hobby: string;
  };
  opinions: string[];
  selfFacts: string[];
  /** Things Clara has explicitly learned about the primary user */
  thingsAboutAttila: string[];
}

export interface ClaraConfig {
  personality: PersonalityConfig;
  self: ClaraMemory;
  defaultUser: {
    userId: string;
    name: string;
    knownFacts: string[];
    preferences: {
      technicalLevel: "beginner" | "intermediate" | "advanced" | "expert";
      preferredStyle: string;
    };
    identity: {
      name: string;
      hardware: string[];
      tools: string[];
      goals: string[];
    };
  };
}

export interface UserKnowledgeNode {
  id: string;
  userId: string;
  /** High-level category of this fact */
  category:
    | "identity"
    | "hardware"
    | "software"
    | "goal"
    | "preference"
    | "opinion"
    | "relationship"
    | "event"
    | "skill"
    | "interest"
    | "location"
    | "habit"
    | "fact";
  /** The actual content of what Clara learned */
  content: string;
  /** How confident Clara is about this (0.0 = inferred, 1.0 = explicitly stated) */
  confidence: number;
  /** 0.0-1.0 importance of this fact for understanding the user */
  importance: number;
  /** ISO timestamp of when Clara first learned this */
  learnedAt: number;
  /** ISO timestamp of when it was last confirmed/referenced */
  lastConfirmedAt: number;
  /** Number of times this has come up in conversation */
  mentionCount: number;
  /** Source — "stated" means user said it directly, "inferred" means Clara derived it */
  source: "stated" | "inferred" | "seeded";
  /** Related nodes (other UserKnowledgeNode ids) */
  relatedNodeIds: string[];
}

export interface UserKnowledgeGraph {
  userId: string;
  nodes: UserKnowledgeNode[];
  lastUpdated: number;
  totalConversations: number;
  /** Vector embeddings for semantic search over knowledge nodes */
  embeddings?: Record<string, number[]>;
}

export interface ClaraSharedFact {
  id: string;
  content: string;
  category: "self" | "opinion" | "experience" | "capability" | "preference";
  sharedAt: number;
  sharedWith: string; // userId
}

export interface ClaraSelfState {
  memory: ClaraMemory;
  /** Facts Clara has shared about herself with each user */
  sharedFacts: ClaraSharedFact[];
  /** Clara's evolving understanding of herself */
  selfInsights: string[];
  lastUpdated: number;
}
