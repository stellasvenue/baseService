const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, TranslateConfig, PutCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

class BaseService {
  constructor () {
    // Initialize S3 client
    this._s3 = new S3Client({})

    // Initialize DynamoDB client and document client
    const dynamoDBClient = new DynamoDBClient({})
    const translateConfig = {
      marshallOptions: {
        removeUndefinedValues: true, // Automatically handle undefined values
        convertClassInstanceToMap: true
      },
      unmarshallOptions: {
        wrapNumbers: false // Parse numbers normally
      }
    }
    this._db = DynamoDBDocumentClient.from(dynamoDBClient, translateConfig)

    // Initialize EventBridge and Lambda clients
    this._eventBridge = new EventBridgeClient({})
    this._lambda = new LambdaClient({})

    this._reservedKeyword = [
      'start', 'stop', 'help', 'cancel', 'end', 'quit', 'unsubscribe',
      'stop', 'stopall', 'info', 'upgrade', 'quote', 'last', 'call'
    ]
  }

  async storeDB (PK, SK, data) {
    const params = {
      TableName: process.env.SYSTEMTABLE,
      Item: this.sanitizeData({ PK, SK, attributes: data })
    }
    return await this._db.send(new PutCommand(params))
  }

  async getDB (PK, SK) {
    const params = {
      TableName: process.env.SYSTEMTABLE,
      Key: { PK, SK }
    }
    return await this._db.send(new GetCommand(params))
  }

  async getDBBySKPrefix(PK, SKPrefix) {
    const params = {
      TableName: process.env.SYSTEMTABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": PK,
        ":skPrefix": SKPrefix,
      },
    };

    try {
      const result = await this._db.send(new QueryCommand(params));
      return result.Items; // Return the matching items
    } catch (error) {
      console.error("Error fetching items by SK prefix:", error);
      throw error;
    }
  }

  async getDbGSI2PK(GSI2PKValue) {
    const params = {
      TableName: process.env.SYSTEMTABLE,
      IndexName: 'GSI2PK', // Name of your GSI index
      KeyConditionExpression: 'GSI2PK = :gsi2pk', // Use the GSI key
      ExpressionAttributeValues: {
        ':gsi2pk': GSI2PKValue, // The value to query against
      },
    };

    try {
      const result = await this._db.send(new QueryCommand(params));
      return result.Items; // Returns an array of items from the query
    } catch (error) {
      console.error('Error querying GSI2PK:', error);
      throw error;
    }
  }

  async getDbGSI3PK(GSI3PKValue) {
    const params = {
      TableName: process.env.SYSTEMTABLE,
      IndexName: 'GSI3PK', // Name of your GSI index
      KeyConditionExpression: 'GSI3PK = :gsi3pk', // Use the GSI key
      ExpressionAttributeValues: {
        ':gsi3pk': GSI3PKValue, // The value to query against
      },
    };

    try {
      const result = await this._db.send(new QueryCommand(params));
      return result.Items; // Returns an array of items from the query
    } catch (error) {
      console.error('Error querying GSI2PK:', error);
      throw error;
    }
  }

  async updateDB(PK, SK, data, optionalKeys = {}) {
    // Destructure optional keys from the optionalKeys object
    const { GSI1PK, GSI1SK, GSI2PK, GSI3PK } = optionalKeys;

    // Start with the basic UpdateExpression and values
    let updateExpression = 'set attributes = :a';
    const expressionAttributeValues = { ':a': data };
    const expressionAttributeNames = {};

    // Dynamically add optional keys
    if (GSI1PK) {
      updateExpression += ', #gsi1pk = :gsi1pk';
      expressionAttributeValues[':gsi1pk'] = GSI1PK;
      expressionAttributeNames['#gsi1pk'] = 'GSI1PK';
    }
    if (GSI1SK) {
      updateExpression += ', #gsi1sk = :gsi1sk';
      expressionAttributeValues[':gsi1sk'] = GSI1SK;
      expressionAttributeNames['#gsi1sk'] = 'GSI1SK';
    }
    if (GSI2PK) {
      updateExpression += ', #gsi2pk = :gsi2pk';
      expressionAttributeValues[':gsi2pk'] = GSI2PK;
      expressionAttributeNames['#gsi2pk'] = 'GSI2PK';
    }
    if (GSI3PK) {
      updateExpression += ', #gsi3pk = :gsi3pk';
      expressionAttributeValues[':gsi3pk'] = GSI3PK;
      expressionAttributeNames['#gsi3pk'] = 'GSI3PK';
    }

    // Construct the final params object
    const params = {
      TableName: process.env.SYSTEMTABLE,
      Key: { PK, SK },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    };

    // Only include ExpressionAttributeNames if there are optional keys
    if (Object.keys(expressionAttributeNames).length > 0) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    // Execute the update command
    return await this._db.send(new UpdateCommand(params));
  }

  async deleteDBItem(PK, SK) {
    const params = {
      TableName: process.env.SYSTEMTABLE,
      Key: {
        PK: PK,
        SK: SK,
      },
    };

    try {
      const result = await this._db.send(new DeleteCommand(params));
      console.log("Item deleted successfully:", { PK, SK });
      return result; // Return result or metadata if needed
    } catch (error) {
      console.error("Error deleting item:", error);
      throw error; // Rethrow the error for further handling
    }
  }

  async putEvents (eventName, data) {
    const params = {
      Entries: [
        {
          Source: 'system',
          DetailType: String(eventName),
          Detail: JSON.stringify(data),
          EventBusName: 'default'
        }
      ]
    }
    return await this._eventBridge.send(new PutEventsCommand(params))
  }

  async logObject (fileName, data) {
    const params = {
      Bucket: process.env.MESSAGE_BUCKET,
      Key: String(fileName),
      Body: JSON.stringify(data)
    }
    return await this._s3.send(new PutObjectCommand(params))
  }

  async uploadReadableStream (fileName, readableStream) {
    const uploadParams = {
      Bucket: process.env.MESSAGE_BUCKET,
      Key: String(fileName),
      Body: readableStream
    }
    const upload = new Upload({
      client: this._s3,
      params: uploadParams
    })
    return await upload.done()
  }

  camelize (str) {
    return str
        .replace(/\s/g, '')
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 ? word.toLowerCase() : word.toUpperCase())
        .replace(/\s+/g, '')
  }

  isEmpty (obj) {
    return Object.keys(obj).length === 0
  }

  async checkOpenTask (phoneNumber) {
    const params = {
      TableName: process.env.SYSTEMTABLE,
      KeyConditionExpression: 'PK = :pk and begins_with(SK, :sk)',
      FilterExpression: '#attributes.#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#attributes': 'attributes'
      },
      ExpressionAttributeValues: {
        ':pk': phoneNumber,
        ':sk': 'task#',
        ':status': 'pending'
      }
    }
    const result = await this._db.send(new QueryCommand(params))
    return result.Items
  }

  async invokeStep (functionName, payload) {
    const params = {
      FunctionName: 'StellasVenue-prod-' + functionName,
      InvocationType: 'Event',
      Payload: JSON.stringify(payload)
    }
    return await this._lambda.send(new InvokeCommand(params))
  }

  async getFile (fileName) {
    const params = {
      Bucket: process.env.MESSAGE_BUCKET,
      Key: String(fileName)
    }
    return await this._s3.send(new GetObjectCommand(params))
  }

  dateToISOString (date) {
    return new Date(date).toISOString()
  }

  sanitizeData(data) {
    return JSON.parse(
        JSON.stringify(data, (key, value) =>
            value instanceof Date ? value.toISOString() : value
        )
    );
  }

  createUrlString(obj) {
    // Initialize an array to hold the encoded key=value strings
    let encodedParams = [];

    // Loop through each object in the array
    obj.forEach(item => {
      // Loop through each key in the object
      for (let key in item) {
        if (item.hasOwnProperty(key)) {
          // Encode the key and value, then combine them with an equals sign
          let encodedKey = encodeURIComponent(key);
          let encodedValue = encodeURIComponent(item[key]);
          encodedParams.push(`${encodedKey}=${encodedValue}`);
        }
      }
    });

    // Join all key=value strings with an ampersand (&)
    return encodedParams.join("&");
  }

  subtractOneHour(time) {
    // Split the input time into hours and minutes
    let [hours, minutes] = time.split(':').map(Number);

    // Subtract one hour
    hours -= 1;

    // Handle the case where hours become negative (e.g., 00:00 - 1 hour should be 23:00)
    if (hours < 0) {
      hours = 23;
    }

    // Format hours and minutes back to two digits format
    let formattedHours = String(hours).padStart(2, '0');
    let formattedMinutes = String(minutes).padStart(2, '0');

    // Return the new time
    return `${formattedHours}:${formattedMinutes}`;
  }

  isWeekend(dateStr) {
    const date = new Date(dateStr + 'T00:00:00Z');
    // console.log('Date object:', date);
    // console.log('Date UTC string:', date.toUTCString());

    const dayOfWeek = date.getUTCDay();

    if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
      return 'Weekend';
    } else {
      return 'Weekday';
    }
  }

  getFutureDate(days) {
    const currentDate = new Date();
    const futureDate = new Date();

    futureDate.setDate(currentDate.getDate() + days);

    return futureDate;
  }

}

module.exports = BaseService