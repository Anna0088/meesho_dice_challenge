# Seller Service API Documentation

## Base URL
```
http://localhost:3001/api/v1
```

## Authentication
All endpoints require JWT authentication token in the Authorization header:
```
Authorization: Bearer <token>
```

## Endpoints

### 1. Register Seller
```http
POST /sellers/register
```

#### Request Body
```json
{
  "email": "seller@example.com",
  "phone": "+919876543210",
  "business_name": "ABC Traders",
  "seller_tier": "individual" | "small_business" | "verified_brand"
}
```

#### Response
```json
{
  "sellerId": "uuid-v4",
  "status": "pending_verification",
  "message": "Seller registration initiated successfully"
}
```

### 2. Upload Verification Documents
```http
POST /sellers/:sellerId/documents
```

#### Request Body (multipart/form-data)
- `document_type`: Type of document (national_id_front, national_id_back, business_registration, etc.)
- `file`: Document file

#### Response
```json
{
  "documentId": "uuid-v4",
  "upload_url": "presigned-s3-url",
  "status": "uploaded"
}
```

### 3. Trigger Verification
```http
POST /sellers/:sellerId/verify
```

#### Response
```json
{
  "verification_job_id": "uuid-v4",
  "status": "verification_in_progress",
  "estimated_time": "2 hours"
}
```

### 4. Get Verification Status
```http
GET /sellers/:sellerId/status
```

#### Response
```json
{
  "sellerId": "uuid-v4",
  "verification_status": "approved" | "rejected" | "pending" | "info_required",
  "rejection_reason": null | "Invalid documents",
  "required_documents": ["business_registration"],
  "last_updated": "2024-01-01T00:00:00Z"
}
```

### 5. Get Seller Quality Score
```http
GET /sqs/:sellerId
```

#### Response
```json
{
  "sellerId": "uuid-v4",
  "overall_score": 850,
  "pillars": {
    "catalog_excellence": {
      "score": 90,
      "metrics": {
        "image_quality_score": 95,
        "description_completeness": 88,
        "attribute_fill_rate": 92,
        "duplicate_listing_score": 85
      }
    },
    "operational_efficiency": {
      "score": 85,
      "metrics": {
        "order_fulfillment_rate": 98,
        "on_time_shipping_rate": 92,
        "seller_cancellation_rate": 2,
        "seller_response_time": 1.5
      }
    },
    "customer_satisfaction": {
      "score": 80,
      "metrics": {
        "average_product_rating": 4.2,
        "order_defect_rate": 1.5,
        "return_rate": 3.2
      }
    }
  },
  "calculated_at": "2024-01-01T00:00:00Z",
  "trend": {
    "direction": "up",
    "change": 15,
    "period": "30_days"
  }
}
```

### 6. Get Seller Dashboard Analytics
```http
GET /sellers/:sellerId/analytics
```

#### Query Parameters
- `period`: 7d | 30d | 90d | 1y
- `metrics`: comma-separated list of metrics to fetch

#### Response
```json
{
  "kpis": {
    "total_revenue": 150000,
    "total_orders": 750,
    "average_order_value": 200,
    "sqs_score": 850
  },
  "recommendations": [
    {
      "priority": "high",
      "category": "operations",
      "message": "Your on-time shipping rate has dropped by 10% this week",
      "action": "Ensure all new orders are dispatched within 24 hours",
      "impact": "Can improve SQS by 50 points"
    }
  ],
  "performance_trends": {
    "dates": ["2024-01-01", "2024-01-02", ...],
    "revenue": [5000, 5500, ...],
    "orders": [25, 28, ...],
    "sqs": [840, 845, ...]
  }
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid request",
  "message": "Missing required field: email",
  "code": "INVALID_REQUEST"
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication failed",
  "message": "Invalid or expired token",
  "code": "AUTH_FAILED"
}
```

### 404 Not Found
```json
{
  "error": "Resource not found",
  "message": "Seller with ID xxx not found",
  "code": "NOT_FOUND"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred",
  "code": "INTERNAL_ERROR"
}
```

## Rate Limiting
- 100 requests per 15 minutes per IP address
- 1000 requests per hour per authenticated user

## Webhook Events

The seller service emits the following webhook events:

1. `seller.registered` - New seller registration
2. `seller.verified` - Verification completed
3. `seller.document.uploaded` - Document uploaded
4. `sqs.updated` - SQS score updated
5. `seller.tier.changed` - Seller tier changed

Subscribe to webhooks via the webhook management API.