const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')

const port = process.env.PORT || 5000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5hy3n.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const usersCollection = client.db('plantNet').collection('users');
    const plantsCollection = client.db('plantNet').collection('plants');
    const ordersCollection = client.db('plantNet').collection('orders')
    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })
    // save a plant data in db 
    app.post('/plants', verifyToken, async (req, res) => {
      const plant = req.body;
      const result = await plantsCollection.insertOne(plant);
      res.send(result)
    })
    // get all plants from db
    app.get('/plants', async (req, res) => {
      const result = await plantsCollection.find({}).toArray();
      res.send(result)
    })
    // get a plant by id from db
    app.get('/plants/:id', async (req, res) => {
      const {id} = req.params;
      const query = {_id: new ObjectId(id)}
      const result = await plantsCollection.findOne(query)
      if(!result){
        return res.status(404).send({messege: 'Plant not found'})
      }
      res.send(result)
    })
    // save ordered plants in db
    app.post('/orders', verifyToken, async (req, res) => {
      const orderInfo = req.body;
      console.log(orderInfo)
      const result = await ordersCollection.insertOne(orderInfo);
      res.send(result)
    })
    // manage plant stock quantity
    app.patch('/plants/quantity/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const {quantityUpdate, status} = req.body;
      const filter = {_id: new ObjectId(id)}
      let updateDoc = {
        $inc: {
          quantity: -quantityUpdate
        }
      }
      if(status === 'increase'){
        updateDoc = {
          $inc: {
            quantity: quantityUpdate
          }
        }
      }
      const result = await plantsCollection.updateOne(filter, updateDoc)
      res.send(result)
    })
    // get all orders from db for specific user
    app.get('/customer/orders/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = {'customer.email': email};
      const result = await ordersCollection.aggregate([
        {$match: query}, // match the query for a specific user
        {$addFields: {
          'plantId' : {$toObjectId: '$plantId'},// convert plantId to objectId to match with plant collection
        }},
        {$lookup: { // go to a different (plant) collection and get the plant info
          from: 'plants', // collection name (to join)
          localField: 'plantId', // local field (from orders collection) to match with foreign field
          foreignField: '_id', // foreign field (from plant collection) to match with local field
          as: 'plant' // return the data as plant array 
        }},
        {$unwind: '$plant'}, // return the data as object, from array
        {$addFields: { // return only the wanted fields from plant collection
          name: '$plant.name', // return these fields from plant collection
          image: '$plant.image',
          category: '$plant.category',
        }},
        {$project: { // remove the whole plant object and return only wanted fields, if put 1 it will return the field if 0 it won't return anything
          plant: 0
        }}
      ]).toArray();
      res.send(result)
    })
    // cencel order by id for a specific user 
    app.delete('/customer/orders/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const order = await ordersCollection.findOne(query)
      if(order.status === 'Shipped'){
        return res.status(409).send({message: "You can't delete/cencel once the product shipped" })
      }
      const result = await ordersCollection.deleteOne(query)
      res.send(result)
    })

    // save or update user in db 
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = req.body;
      // checking if user is exist in db 
      const isExist = await usersCollection.findOne(query)
      if (isExist) {
        return res.send(isExist)
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: 'customer',
        timeStamp: Date.now(),
      })
      res.send(result)// need to restart the class from 5
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
