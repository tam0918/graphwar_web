# Diagram Sources for Graphwar Report

Use these codes to generate images at [Mermaid Live Editor](https://mermaid.live).
Save the images as `.png` files in this directory: `latex_report/`.

## 1. usecase_diagram.png

```mermaid
graph LR
    Player((Player))
    
    subgraph "Room Management"
        UC1(Create Room)
        UC2(Join Room)
        UC3(Configure Room)
        UC4(Add Bots)
    end
    
    subgraph "Gameplay"
        UC5(Fire Shot)
        UC6(Get AI Hint)
        UC7(Surrender)
    end
    
    subgraph "Social & Stats"
        UC8(Chat)
        UC9(View Leaderboard)
    end
    
    Player --- UC1
    Player --- UC2
    Player --- UC3
    Player --- UC4
    Player --- UC5
    Player --- UC6
    Player --- UC7
    Player --- UC8
    Player --- UC9
```

## 2. erd_diagram.png

```mermaid
erDiagram
    PLAYER_STATS {
        bigint id PK
        varchar name UK
        int total_games
        int total_wins
        int total_kills
        int best_multi_kill
        timestamp created_at
        timestamp updated_at
    }
```
