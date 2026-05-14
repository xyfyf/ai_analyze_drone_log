-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "userContext" TEXT NOT NULL,
    "contextValidation" TEXT NOT NULL,
    "features" TEXT,
    "diagnosis" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT
);
