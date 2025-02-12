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

  async storeDB(PK, SK, data, indexes = {}) {
    // Destructure optional indexes with defaults
    const { GSI1PK, GSI1SK, GSI2PK, GSI3PK } = indexes;

    // Construct the parameters
    const params = {
      TableName: process.env.SYSTEMTABLE,
      Item: this.sanitizeData({
        PK,
        SK,
        attributes: data,
        ...(GSI1PK && { GSI1PK }),
        ...(GSI1SK && { GSI1SK }),
        ...(GSI2PK && { GSI2PK }),
        ...(GSI3PK && { GSI3PK }),
      }),
    };

    // Execute the DynamoDB PutCommand
    return await this._db.send(new PutCommand(params));
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
  async getDBGSI1SKPrefix(GSI1PK, SKPrefix) {
    const params = {
      TableName: process.env.SYSTEMTABLE,
      IndexName: 'GSI1PK', // Name of your GSI index
      KeyConditionExpression: "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":gsi1pk": GSI1PK,
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

  async uploadReadableStream (fileName, readableStream, contentType) {
    const uploadParams = {
      Bucket: process.env.MESSAGE_BUCKET,
      Key: String(fileName),
      Body: readableStream,
    };

    // Only add ContentType if it is passed
    if (contentType) {
      uploadParams.ContentType = contentType;
    }

    const upload = new Upload({
      client: this._s3,
      params: uploadParams,
    });

    return await upload.done();
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
    console.log(params)
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

    if (dayOfWeek === 5 || dayOfWeek === 6 ) {
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

  parseHoursFromString(durationString) {
    const match = durationString.match(/\d+/); // Extracts the first number found
    return match ? parseInt(match[0], 10) : 0; // Converts to integer, default to 0 if not found
  }

  calculateEndTime(startTime, durationString) {
    const hoursToAdd = parseFloat(durationString);

    // Check if startTime is in HH:mm (24-hour) format using a simple regex
    const militaryTimeRegex = /^\d{2}:\d{2}$/;
    const isMilitaryTime = militaryTimeRegex.test(startTime);

    let date;

    if (isMilitaryTime) {
      // Parse "HH:mm" into hours/minutes
      const [startHour, startMinute] = startTime.split(':').map(Number);

      // Create a new Date object for "today" (the date portion is arbitrary)
      date = new Date();
      date.setHours(startHour, startMinute, 0, 0);

      // Add the hours to the date
      date.setHours(date.getHours() + hoursToAdd);

      // Format back to HH:mm
      const endHour = String(date.getHours()).padStart(2, '0');
      const endMinute = String(date.getMinutes()).padStart(2, '0');
      return `${endHour}:${endMinute}`;
    } else {
      // Assume it's an ISO date/time string
      date = new Date(startTime);

      // Add the hours
      date.setHours(date.getHours() + hoursToAdd);

      // Return as ISO
      return date.toISOString();
    }
  }

  isoToStandardDate(isoString) {
    const date = new Date(isoString);

    if (isNaN(date.getTime())) {
      return "Invalid Date";
    }

    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  isoToStandardTime(isoString) {
    const date = new Date(isoString);

    if (isNaN(date.getTime())) {
      return "Invalid Time";
    }

    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  }

  convert24to12(time24) {
    // Split the input into hours and minutes
    let [hourStr, minuteStr] = time24.split(":");

    // Convert hour to a number
    let hour = parseInt(hourStr, 10);

    // Determine AM or PM suffix
    const suffix = hour >= 12 ? "PM" : "AM";

    // Convert "hour" to 12-hour format (0 should map to 12)
    hour = hour % 12 || 12;

    // Return the formatted string
    return `${hour}:${minuteStr} ${suffix}`;
  }

  combineISODateAndTime(dateISO, time) {
    // Ensure the input date is a valid ISO date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
      throw new Error("Invalid date format. Expected YYYY-MM-DD.");
    }

    // Ensure the input time is a valid time format
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
      throw new Error("Invalid time format. Expected HH:MM or HH:MM:SS.");
    }

    // Ensure time has seconds
    if (time.length === 5) {
      time += ":00"; // Append ":00" if seconds are missing
    }

    // Create the combined ISO date-time string
    const dateTimeString = `${dateISO}T${time}`;

    // Convert to ISO format with time zone if needed
    const isoDateTime = new Date(dateTimeString).toISOString();

    return isoDateTime;
  }

module.exports = BaseService