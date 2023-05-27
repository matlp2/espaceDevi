


function get_accumulators({
	column_index,
	table_without_header,
	quantile_ratio,
	max_possible,
	min_possible,
}) {

	const ecart_max = Math.abs(max_possible - min_possible)
	const distance_maximale_à_zero = Math.max(Math.abs(max_possible), Math.abs(min_possible))


	const common = {

		_max_dist_to_avg: null,
		get max_dist_to_avg() {// to avg global
			return this._max_dist_to_avg ?? (this._max_dist_to_avg = (
				function(){
					const column = table_without_header.map(line => line[column_index])
					const sum = column.reduce((acc,val) => acc+val, 0)
					const avg = sum/table_without_header.length
					const max_dist_to_avg = column.reduce((acc,val) => Math.max(acc, Math.abs(avg-val)), 0)
					return max_dist_to_avg
				}()
			))
		},

		_column: null,
		get column() {
			if(this._column == null) {
				this._column = table_without_header.map(line=>line[column_index])
			}
			return this._column
		},


		_max_distance_to_zero: null,
		get max_distance_to_zero() {
			if(this._max_distance_to_zero == null) {
				this._max_distance_to_zero = this.column.reduce((acc, val) => Math.max(acc, Math.abs(val)), 0)
			}
			return this._max_distance_to_zero
		},

		_sorted_column: null,
		get sorted_column() { return this._sorted_column ??= table_without_header.map(line=>line[column_index]).sort((a,b)=>a-b) },

		_max_distance_between_two_successive_values: null,
		get max_distance_between_two_successive_values() {
			if(this._max_distance_between_two_successive_values == null) {
				// pas valeurs successives mais avec un nombre entre chanque en fait
				//this._max_distance_between_two_successive_values = this.sorted_column.slice(0, this.sorted_column.length-2).reduce((acc, val, i) => Math.max(acc, Math.abs(val - column[i+2])), 0)
				const col = this.sorted_column
				this._max_distance_between_two_successive_values = col.slice(0, col.length-1).reduce((acc, val, i) => Math.max(acc, Math.abs(val - col[i+1])), 0)
			}
			return this._max_distance_between_two_successive_values
		},

		_quantile_sensibility:null,
		get quantile_sensibility() {
			return this._quantile_sensibility ?? (

				this._quantile_sensibility = (

					this.sorted_column.length == 1 ?

						Math.abs(this.sorted_column[0])

					: this.sorted_column.length == 2 ?

						Math.abs(Math.max(this.sorted_column[0],this.sorted_column[1]))
					:
						this.max_distance_between_two_successive_values
				)
			)
		}
	}


	accumulators = {

		count: {
			maker({}) {
				return ()=> {
					return {
						val: 0,
						accumulate() { ++this.val },
						sensibility: 1,
					}
				}
			}
		},
		count_distinct: {
			maker({}) {
				return ()=> {
					return {
						get val() { return this.set.size },
						set: new Set(),
						accumulate(line) { this.set.add(line[column_index]) },
						sensibility: 1,
					}
				}
			}
		},
		min: {
			maker({}) {

				return ()=> {
					return {
						val: Number.MAX_VALUE,
						accumulate(line) { this.val = Math.min(this.val, line[column_index]) },
						//get sensibility() {return common.max_distance_to_zero/table_without_header.length },
						//get sensibility() {return ecart_max/2/table_without_header.length },
						get sensibility() {return ecart_max/table_without_header.length },
					}
				}
			}
		},
		max: {
			maker({}) {

				return ()=> {
					return {
						val: Number.MIN_VALUE,
						accumulate(line) { this.val = Math.max(this.val, line[column_index]) },
						//get sensibility() {return ecart_max/2/table_without_header.length },
						get sensibility() {return ecart_max/table_without_header.length },
					}
				}
			}
		},
		sum: {
			maker({}) {

				/*table.columns = new Proxy({}, {
					get(columns, attr) {
						if(Number.isInteger(attr)) {
							if(columns[attr] === undefined) {

								const column = table.map(line => line[attr])

								columns[attr] = new Proxy(

									column,

									{
										column,

										get(column, member, proxy) {
											if(member in column) return column[member]
											return this[member]
										},
										
										// max_distance_to_zero
										_max_distance_to_zero: null,
										get max_distance_to_zero() {
											if(this._max_distance_to_zero == null) {
												this._max_distance_to_zero = this.column.reduce((acc, val) => Math.max(acc, Math.abs(val)), 0)
											}
											return this._max_distance_to_zero
										},
									}
								)
							}
							return columns[attr]
						}
						else{
							throw "not column_index"
						}
					}
				});*/

				return () => {
					return {
						val: 0,
						accumulate(line) { this.val += line[column_index] },
						//get sensibility() { return common.max_distance_to_zero }
						get sensibility() { return distance_maximale_à_zero }
					}
				}
			}
		},
		avg: {// mean
			maker({}) {

				return () => {
					return {
						get val() { return this.sum / this.count },
						count: 0,
						sum: 0,
						made_by: this,
						accumulate(line) {
							++this.count
							this.sum += line[column_index]
						},
						//get sensibility() { return common.max_distance_to_zero / this.count }
						get sensibility() { return distance_maximale_à_zero / this.count }
					}
				}
			}
				
		},
		median: {
			maker({}) {

				return ()=> {
					return {
						get val() {
							//return this.column.sort((a,b)=>a-b)[parseInt(this.column.length/2)] // une autre version consiste à faire la moyenne sur 2 valeurs si la longeur est paire 
							return common.sorted_column[parseInt(this.column.length/2)] // une autre version consiste à faire la moyenne sur 2 valeurs si la longeur est paire 
						},
						//count: 0,
						column: [],
						//accumulate(line) { this.column.push(line[column_index]) },
						accumulate(line) {},
						//get sensibility() { return common.quantile_sensibility }
						get sensibility() { return ecart_max/table_without_header.length }
					}
				}
			}
		},
		variance:  {
			maker({}) {

				return ()=> {
					return {
						get val() {
							const avg = this.sum / this.column.length
							let sum_diff = 0
							for(const val of this.column) {
								sum_diff += (val-avg)**2
							}
							return sum_diff / this.column.length
						},
						sum: 0,
						column: [],
						//column: new Float64Array(),
						accumulate(line) {
							this.sum += line[column_index]
							this.column.push(line[column_index])
						},
						//get sensibility() { return common.max_dist_to_avg/this.column.length }
						//get sensibility() { return ecart_max/2/this.column.length }
						get sensibility() { return (ecart_max)**2/this.column.length }
					}
				}
			}
		},
		standard_deviation: {
			maker({}){

				return ()=> {
					return {
						variance: accumulators.variance.maker(column_index)(),
						get val() { return Math.sqrt(this.variance.val) },
						accumulate: function(line) { this.variance.accumulate(line) },
						get sensibility() { return ecart_max/this.column.length }
					}
				}
			}
		},
		quantile: {
			maker({}){

				/*const common = {

					_sorted_column: null,
					get sorted_column() {
						if(this._sorted_column == null) {
							this._sorted_column = table_without_header.map(line=>line[column_index]).sort((a,b)=>a-b)
						}
						return this._sorted_column
					},
	
					_max_distance_between_two_successive_values: null,
					get max_distance_between_two_successive_values() {
						if(this._max_distance_between_two_successive_values == null) {
							// pas valeurs successives mais avec un nombre entre chanque en fait
							this._max_distance_between_two_successive_values = this.sorted_column.slice(0, column.length-2).reduce((acc, val, i) => Math.max(acc, Math.abs(val - column[i+2])), 0)
						}
						return this._max_distance_between_two_successive_values
					},
	
					_sensibility:null,
					get sensibility() {
						return this._sensibility ?? (
	
							this._sensibility = (
	
								this.sorted_column.length == 1 ?
	
									Math.abs(this.sorted_column[0])
	
								: this.sorted_column.length == 2 ?
	
									Math.abs(Math.max(this.sorted_column[0],this.sorted_column[1]))
								:
									this.max_distance_between_two_successive_values
							)
						)
					}
				}*/

				return ()=> {
					return {
						get val() {

							this.column.sort((a,b)=>a-b)

							let line_index = Math.floor(quantile_ratio*this.column.length)
		
							if(line_index < 0) line_index = 0
							if(line_index >= this.column.length) line_index = this.column.length - 2

							return this.column[line_index]
						},
						column:[],
						accumulate: function(line) {
							if(line[column_index] != NaN) this.column.push(line[column_index])
						},
						//get sensibility() { return common.quantile_sensibility },
						get sensibility() { return ecart_max/this.column.length },
					}
				}
			}
		},
	}

	accumulators.mean = accumulators.avg
	accumulators.stdev = accumulators.standard_deviation
	accumulators.stddev = accumulators.standard_deviation
	accumulators.average = accumulators.avg

	return accumulators
}
